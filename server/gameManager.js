// ─── gameManager.js ─── Server-authoritative game logic ───

const rooms = new Map();
const QUESTION_BANK = require("./questions");

// ─── Global State ───
let globalOnline = 0;
const leaderboard = []; // {name, score, cat, date, roomCode}

// ─── Fuzzy String Matching ───

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function normalizeArabic(text) {
  return text
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function checkAnswer(submitted, correct) {
  const a = normalizeArabic(submitted);
  const b = normalizeArabic(correct);
  if (a === b) return { match: true, similarity: 100 };
  if (a.includes(b) || b.includes(a)) return { match: true, similarity: 95 };
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return { match: false, similarity: 0 };
  const dist = levenshtein(a, b);
  const similarity = Math.round((1 - dist / maxLen) * 100);
  return { match: similarity >= 70, similarity };
}

// ─── Categories ───
function getAvailableCategories() {
  const cats = new Set();
  QUESTION_BANK.forEach(q => cats.add(q.cat));
  return [...cats];
}

// ─── Global Online Count ───
function incrementOnline() { return ++globalOnline; }
function decrementOnline() { return Math.max(0, --globalOnline); }
function getOnlineCount() { return globalOnline; }

// ─── Leaderboard ───

function addToLeaderboard(entry) {
  leaderboard.push({
    name: entry.name,
    score: entry.score,
    cat: entry.cat || "الكل",
    date: Date.now(),
  });
  // Keep max 500 entries to prevent memory bloat
  if (leaderboard.length > 500) leaderboard.splice(0, leaderboard.length - 500);
}

function getLeaderboard(period) {
  const now = Date.now();
  let cutoff;
  if (period === "daily") cutoff = now - 24 * 60 * 60 * 1000;
  else if (period === "monthly") cutoff = now - 30 * 24 * 60 * 60 * 1000;
  else cutoff = 0;

  return leaderboard
    .filter(e => e.date >= cutoff)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// ─── Room Management ───

function generateRoomCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createRoom(hostSocketId, options = {}) {
  const code = generateRoomCode();
  const room = {
    code,
    hostSocketId,
    state: "lobby",
    players: [],
    questions: [],
    currentQuestion: -1,
    buzzedPlayer: null,
    buzzerOpen: false,
    timer: null,
    timerRemaining: 15,
    createdAt: Date.now(),
    chat: [],  // {name, team, msg, type, time}
    settings: {
      categories: options.categories || [],
      questionCount: options.questionCount || 20,
      timerDuration: 15,
    },
  };
  rooms.set(code, room);
  return room;
}

function buildQuestions(room) {
  const { categories, questionCount } = room.settings;
  let pool = QUESTION_BANK;
  if (categories.length > 0) pool = pool.filter(q => categories.includes(q.cat));
  room.questions = shuffle([...pool]).slice(0, Math.min(questionCount, pool.length));
}

function getRoomCount() { return rooms.size; }

function getAllRoomInfo() {
  const info = [];
  for (const [, room] of rooms) {
    info.push({
      code: room.code,
      state: room.state,
      playerCount: room.players.filter(p => p.connected).length,
    });
  }
  return info;
}

// ─── Player Management ───

function addPlayer(roomCode, name, team, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return { success: false, error: "الغرفة غير موجودة" };
  if (room.state === "ended") return { success: false, error: "اللعبة انتهت" };

  const existing = room.players.find(p => p.name === name);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.team = team;
    return { success: true, player: existing, reconnected: true };
  }

  const teamCount = room.players.filter(p => p.team === team).length;
  if (teamCount >= 10) return { success: false, error: "الفريق ممتلئ" };

  const player = {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name, team, score: 0, socketId, connected: true,
  };
  room.players.push(player);
  return { success: true, player, reconnected: false };
}

function disconnectPlayer(socketId) {
  for (const [, room] of rooms) {
    const player = room.players.find(p => p.socketId === socketId);
    if (player) {
      player.connected = false;
      return { room, player };
    }
  }
  return null;
}

function kickPlayer(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx === -1) return null;
  const player = room.players[idx];
  room.players.splice(idx, 1);
  return { room, player };
}

// ─── Chat ───

function addChatMessage(roomCode, name, team, msg, type = "text") {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const entry = { name, team, msg, type, time: Date.now() };
  room.chat.push(entry);
  if (room.chat.length > 100) room.chat.shift();
  return entry;
}

function addReaction(roomCode, name, team, emoji) {
  return addChatMessage(roomCode, name, team, emoji, "reaction");
}

// ─── Game Flow ───

function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "lobby") return null;
  if (room.players.filter(p => p.connected).length < 1) return null;
  buildQuestions(room);
  room.state = "playing";
  room.currentQuestion = 0;
  room.buzzedPlayer = null;
  room.buzzerOpen = false;
  return room;
}

function getCurrentQuestion(room) {
  if (room.currentQuestion < 0 || room.currentQuestion >= room.questions.length) return null;
  const q = room.questions[room.currentQuestion];
  const result = { text: q.q, cat: q.cat || "", index: room.currentQuestion, total: room.questions.length };
  if (q.img) result.img = q.img;
  return result;
}

function getCurrentQuestionFull(room) {
  if (room.currentQuestion < 0 || room.currentQuestion >= room.questions.length) return null;
  const q = room.questions[room.currentQuestion];
  const result = { text: q.q, answer: q.a, cat: q.cat || "", diff: q.diff || "", index: room.currentQuestion, total: room.questions.length };
  if (q.img) result.img = q.img;
  return result;
}

// ─── Buzzer ───

function openBuzzer(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return false;
  room.buzzerOpen = true;
  room.buzzedPlayer = null;
  return true;
}

function handleBuzz(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return { success: false };
  if (!room.buzzerOpen || room.buzzedPlayer) return { success: false };
  const player = room.players.find(p => p.socketId === socketId && p.connected);
  if (!player) return { success: false };
  room.buzzerOpen = false;
  room.buzzedPlayer = { id: player.id, name: player.name, team: player.team };
  room.timerRemaining = room.settings.timerDuration;
  return { success: true, player };
}

// ─── Answer ───

function submitAnswer(roomCode, socketId, answerText) {
  const room = rooms.get(roomCode);
  if (!room || !room.buzzedPlayer) return null;
  const player = room.players.find(p => p.socketId === socketId);
  if (!player || player.id !== room.buzzedPlayer.id) return null;
  const q = room.questions[room.currentQuestion];
  if (!q) return null;

  const result = checkAnswer(answerText, q.a);
  if (result.match) player.score += 1;

  const buzzed = room.buzzedPlayer;
  room.buzzedPlayer = null;
  room.buzzerOpen = false;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }

  return {
    correct: result.match, similarity: result.similarity,
    playerName: buzzed.name, team: buzzed.team,
    submittedAnswer: answerText, correctAnswer: q.a,
    scores: getScores(room),
  };
}

function judgeAnswer(roomCode, correct) {
  const room = rooms.get(roomCode);
  if (!room || !room.buzzedPlayer) return null;
  const buzzed = room.buzzedPlayer;
  if (correct) {
    const player = room.players.find(p => p.id === buzzed.id);
    if (player) player.score += 1;
  }
  room.buzzedPlayer = null;
  room.buzzerOpen = false;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  return { correct, playerName: buzzed.name, team: buzzed.team, scores: getScores(room) };
}

// ─── Navigation ───

function nextQuestion(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return null;
  room.currentQuestion += 1;
  room.buzzedPlayer = null;
  room.buzzerOpen = false;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.currentQuestion >= room.questions.length) {
    room.state = "ended";
    // Add players to leaderboard
    const cats = room.settings.categories.join("، ") || "الكل";
    room.players.forEach(p => {
      if (p.score > 0) addToLeaderboard({ name: p.name, score: p.score, cat: cats });
    });
    return { question: null, gameOver: true, scores: getScores(room) };
  }
  return { question: getCurrentQuestion(room), gameOver: false };
}

function skipQuestion(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return null;
  room.buzzedPlayer = null;
  room.buzzerOpen = false;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  return { skipped: true };
}

// ─── Scores ───

function getScores(room) {
  const teamA = room.players.filter(p => p.team === "A");
  const teamB = room.players.filter(p => p.team === "B");
  return {
    A: teamA.reduce((s, p) => s + p.score, 0),
    B: teamB.reduce((s, p) => s + p.score, 0),
    players: room.players.map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected })),
  };
}

function getPlayerInfo(room) {
  return {
    count: room.players.filter(p => p.connected).length,
    players: room.players.map(p => ({ id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected })),
  };
}

// ─── Accessors ───

function getRoom(code) { return rooms.get(code) || null; }
function getRoomByHost(socketId) {
  for (const [, room] of rooms) { if (room.hostSocketId === socketId) return room; }
  return null;
}
function deleteRoom(code) {
  const room = rooms.get(code);
  if (room && room.timer) clearInterval(room.timer);
  rooms.delete(code);
}
function updateSettings(roomCode, settings) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "lobby") return false;
  if (settings.categories) room.settings.categories = settings.categories;
  if (settings.questionCount) room.settings.questionCount = settings.questionCount;
  return true;
}

function clearLeaderboard() { leaderboard.length = 0; }

module.exports = {
  createRoom, addPlayer, disconnectPlayer, kickPlayer,
  startGame, getCurrentQuestion, getCurrentQuestionFull,
  handleBuzz, openBuzzer, submitAnswer, judgeAnswer,
  nextQuestion, skipQuestion,
  getScores, getPlayerInfo, getRoom, getRoomByHost, deleteRoom, clearLeaderboard,
  updateSettings, getAvailableCategories, checkAnswer,
  incrementOnline, decrementOnline, getOnlineCount,
  addChatMessage, addReaction,
  getLeaderboard, addToLeaderboard,
  getRoomCount, getAllRoomInfo,
};
