// ─── gameManager.js ─── Server-authoritative game logic ───

const rooms = new Map();
const QUESTION_BANK = require("./questions");

// ─── Fuzzy String Matching ───

/**
 * Calculate Levenshtein distance between two strings
 */
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

/**
 * Normalize Arabic text for comparison
 * Removes diacritics, normalizes alef/taa/yaa, trims whitespace
 */
function normalizeArabic(text) {
  return text
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // remove tashkeel
    .replace(/[أإآ]/g, "ا")  // normalize alef
    .replace(/ة/g, "ه")      // taa marbuta → haa
    .replace(/ى/g, "ي")      // alef maqsura → yaa
    .replace(/\s+/g, " ")    // normalize whitespace
    .trim()
    .toLowerCase();
}

/**
 * Check if answer matches with ~80% similarity
 * Returns { match: boolean, similarity: number }
 */
function checkAnswer(submitted, correct) {
  const a = normalizeArabic(submitted);
  const b = normalizeArabic(correct);

  // Exact match after normalization
  if (a === b) return { match: true, similarity: 100 };

  // Check if submitted contains the correct answer or vice versa
  if (a.includes(b) || b.includes(a)) return { match: true, similarity: 95 };

  // Levenshtein similarity
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return { match: false, similarity: 0 };
  const dist = levenshtein(a, b);
  const similarity = Math.round((1 - dist / maxLen) * 100);

  return { match: similarity >= 70, similarity };
}

// ─── Available categories from question bank ───
function getAvailableCategories() {
  const cats = new Set();
  QUESTION_BANK.forEach(q => cats.add(q.cat));
  return [...cats];
}

// ─── Room Code Generator ───
function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

// ─── Shuffle array (Fisher-Yates) ───
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Create Room ───
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
    // Game settings (host configurable)
    settings: {
      categories: options.categories || [],    // empty = all
      questionCount: options.questionCount || 20,
      timerDuration: 15,
    },
  };

  rooms.set(code, room);
  return room;
}

/**
 * Build and shuffle question set based on room settings
 */
function buildQuestions(room) {
  const { categories, questionCount } = room.settings;

  let pool = QUESTION_BANK;
  if (categories.length > 0) {
    pool = pool.filter(q => categories.includes(q.cat));
  }

  // Shuffle and pick
  const shuffled = shuffle([...pool]);
  room.questions = shuffled.slice(0, Math.min(questionCount, shuffled.length));
}

// ─── Player Management ───

function addPlayer(roomCode, name, team, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return { success: false, error: "الغرفة غير موجودة" };
  if (room.state === "ended") return { success: false, error: "اللعبة انتهت" };

  // Reconnection check
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
    name,
    team,
    score: 0,
    socketId,
    connected: true,
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

// ─── Game Flow ───

function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "lobby") return null;
  if (room.players.filter(p => p.connected).length < 1) return null;

  // Build fresh randomized questions
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
  return {
    text: q.q,
    cat: q.cat || "",
    index: room.currentQuestion,
    total: room.questions.length,
  };
}

function getCurrentQuestionFull(room) {
  if (room.currentQuestion < 0 || room.currentQuestion >= room.questions.length) return null;
  const q = room.questions[room.currentQuestion];
  return {
    text: q.q,
    answer: q.a,
    cat: q.cat || "",
    diff: q.diff || "",
    index: room.currentQuestion,
    total: room.questions.length,
  };
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

// ─── Answer Submission (auto-judge with fuzzy matching) ───

function submitAnswer(roomCode, socketId, answerText) {
  const room = rooms.get(roomCode);
  if (!room || !room.buzzedPlayer) return null;

  // Only the buzzed player can submit
  const player = room.players.find(p => p.socketId === socketId);
  if (!player || player.id !== room.buzzedPlayer.id) return null;

  const q = room.questions[room.currentQuestion];
  if (!q) return null;

  const result = checkAnswer(answerText, q.a);
  const correct = result.match;

  if (correct) {
    player.score += 1;
  }

  const buzzed = room.buzzedPlayer;
  room.buzzedPlayer = null;
  room.buzzerOpen = false;

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  return {
    correct,
    similarity: result.similarity,
    playerName: buzzed.name,
    team: buzzed.team,
    submittedAnswer: answerText,
    correctAnswer: q.a,
    scores: getScores(room),
  };
}

// ─── Manual judge (host override for edge cases) ───

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

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  return {
    correct,
    playerName: buzzed.name,
    team: buzzed.team,
    scores: getScores(room),
  };
}

// ─── Next Question / Game Over ───

function nextQuestion(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return null;

  room.currentQuestion += 1;
  room.buzzedPlayer = null;
  room.buzzerOpen = false;

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  if (room.currentQuestion >= room.questions.length) {
    room.state = "ended";
    return { question: null, gameOver: true, scores: getScores(room) };
  }

  return { question: getCurrentQuestion(room), gameOver: false };
}

// ─── Skip Question (host) ───

function skipQuestion(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "playing") return null;

  room.buzzedPlayer = null;
  room.buzzerOpen = false;
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  return { skipped: true };
}

// ─── Score Helpers ───

function getScores(room) {
  const teamA = room.players.filter(p => p.team === "A");
  const teamB = room.players.filter(p => p.team === "B");
  return {
    A: teamA.reduce((sum, p) => sum + p.score, 0),
    B: teamB.reduce((sum, p) => sum + p.score, 0),
    players: room.players.map(p => ({
      id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected,
    })),
  };
}

function getPlayerInfo(room) {
  const connected = room.players.filter(p => p.connected);
  return {
    count: connected.length,
    players: room.players.map(p => ({
      id: p.id, name: p.name, team: p.team, score: p.score, connected: p.connected,
    })),
  };
}

// ─── Room Accessors ───

function getRoom(code) { return rooms.get(code) || null; }

function getRoomByHost(socketId) {
  for (const [, room] of rooms) {
    if (room.hostSocketId === socketId) return room;
  }
  return null;
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (room && room.timer) clearInterval(room.timer);
  rooms.delete(code);
}

// ─── Update Room Settings ───

function updateSettings(roomCode, settings) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== "lobby") return false;
  if (settings.categories) room.settings.categories = settings.categories;
  if (settings.questionCount) room.settings.questionCount = settings.questionCount;
  return true;
}

module.exports = {
  createRoom, addPlayer, disconnectPlayer, kickPlayer,
  startGame, getCurrentQuestion, getCurrentQuestionFull,
  handleBuzz, openBuzzer, submitAnswer, judgeAnswer,
  nextQuestion, skipQuestion,
  getScores, getPlayerInfo, getRoom, getRoomByHost, deleteRoom,
  updateSettings, getAvailableCategories, checkAnswer,
};
