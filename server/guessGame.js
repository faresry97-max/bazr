// ─── guessGame.js ─── Online free-for-all "من في الصورة" ───

const guessRooms = new Map();

function genCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (guessRooms.has(code));
  return code;
}
function shuffle(a) { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; }

function createRoom(hostSocketId, settings = {}) {
  const code = genCode();
  const room = {
    code,
    hostSocketId,
    hostName: settings.hostName || "المضيف",
    state: "lobby", // lobby | playing | ended
    players: [], // { name, socketId, score, connected }
    questions: [], // loaded from client bank
    currentQuestion: -1,
    roundAnswered: false,
    timer: null,
    timeLeft: 10,
    settings: {
      rounds: settings.rounds || 10,
      timerDuration: 10,
    },
    createdAt: Date.now(),
  };
  guessRooms.set(code, room);
  return room;
}

function joinRoom(code, name, socketId) {
  const room = guessRooms.get(code);
  if (!room) return { success: false, error: "الغرفة غير موجودة" };
  if (room.state === "ended") return { success: false, error: "اللعبة انتهت" };

  // Reconnection
  const existing = room.players.find(p => p.name === name);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    return { success: true, player: existing, reconnected: true };
  }

  if (room.players.length >= 20) return { success: false, error: "الغرفة ممتلئة" };

  const player = { name, socketId, score: 0, connected: true };
  room.players.push(player);
  return { success: true, player, reconnected: false };
}

function startGame(code, questions) {
  const room = guessRooms.get(code);
  if (!room || room.state !== "lobby") return null;
  if (room.players.length < 1) return null;

  room.questions = questions.slice(0, room.settings.rounds);
  room.state = "playing";
  room.currentQuestion = 0;
  room.players.forEach(p => { p.score = 0; });
  return room;
}

function getCurrentQuestion(room) {
  if (room.currentQuestion < 0 || room.currentQuestion >= room.questions.length) return null;
  const q = room.questions[room.currentQuestion];
  return {
    img: q.img, cat: q.cat, opts: q.opts,
    index: room.currentQuestion, total: room.questions.length,
  };
}

function handleAnswer(code, socketId, answer) {
  const room = guessRooms.get(code);
  if (!room || room.state !== "playing" || room.roundAnswered) return null;

  const player = room.players.find(p => p.socketId === socketId && p.connected);
  if (!player) return null;

  const q = room.questions[room.currentQuestion];
  if (!q) return null;

  if (answer === q.a) {
    // Correct — first to answer wins!
    room.roundAnswered = true;
    const pts = 5 + room.timeLeft; // Bonus for speed
    player.score += pts;

    if (room.timer) { clearInterval(room.timer); room.timer = null; }

    return {
      correct: true, playerName: player.name, points: pts,
      correctAnswer: q.a,
      leaderboard: getLeaderboard(room),
    };
  } else {
    return { correct: false, playerName: player.name, correctAnswer: null };
  }
}

function nextQuestion(code) {
  const room = guessRooms.get(code);
  if (!room || room.state !== "playing") return null;

  room.currentQuestion++;
  room.roundAnswered = false;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }

  if (room.currentQuestion >= room.questions.length) {
    room.state = "ended";
    return { gameOver: true, leaderboard: getLeaderboard(room) };
  }

  return { gameOver: false, question: getCurrentQuestion(room) };
}

function timeUp(code) {
  const room = guessRooms.get(code);
  if (!room || room.roundAnswered) return null;
  room.roundAnswered = true;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  const q = room.questions[room.currentQuestion];
  return { correctAnswer: q ? q.a : "" };
}

function getLeaderboard(room) {
  return room.players
    .filter(p => p.connected)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function getPlayerInfo(room) {
  return {
    count: room.players.filter(p => p.connected).length,
    players: room.players.map(p => ({ name: p.name, score: p.score, connected: p.connected })),
  };
}

function disconnectPlayer(socketId) {
  for (const [, room] of guessRooms) {
    const player = room.players.find(p => p.socketId === socketId);
    if (player) { player.connected = false; return { room, player }; }
  }
  return null;
}

function getRoom(code) { return guessRooms.get(code) || null; }
function deleteRoom(code) {
  const room = guessRooms.get(code);
  if (room && room.timer) clearInterval(room.timer);
  guessRooms.delete(code);
}

module.exports = {
  createRoom, joinRoom, startGame, getCurrentQuestion,
  handleAnswer, nextQuestion, timeUp,
  getLeaderboard, getPlayerInfo, disconnectPlayer,
  getRoom, deleteRoom,
};
