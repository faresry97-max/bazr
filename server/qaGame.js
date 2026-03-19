// ─── qaGame.js ─── Q&A Game Mode (Socket.io multiplayer) ───
// Moderator creates session, players join, multiple choice with cards

const qaRooms = new Map();

// ── Built-in Q&A questions (multiple choice) ──
const QA_BANK = [
{cat:"جغرافيا",q:"ما أكبر دولة مساحة؟",o:["الصين","كندا","روسيا","أمريكا"],c:2},
{cat:"جغرافيا",q:"ما عاصمة أستراليا؟",o:["سيدني","ملبورن","كانبرا","بيرث"],c:2},
{cat:"جغرافيا",q:"ما أطول نهر في العالم؟",o:["الأمازون","النيل","المسيسيبي","اليانغتسي"],c:1},
{cat:"جغرافيا",q:"ما أصغر دولة في العالم؟",o:["موناكو","الفاتيكان","سان مارينو","مالطا"],c:1},
{cat:"جغرافيا",q:"ما أكبر محيط في العالم؟",o:["الأطلسي","الهادئ","الهندي","المتجمد"],c:1},
{cat:"جغرافيا",q:"ما عاصمة اليابان؟",o:["أوساكا","طوكيو","كيوتو","هيروشيما"],c:1},
{cat:"جغرافيا",q:"ما أكبر صحراء في العالم من حيث المساحة؟",o:["الربع الخالي","الصحراء الكبرى","غوبي","أنتاركتيكا"],c:3},
{cat:"جغرافيا",q:"ما عاصمة تركيا؟",o:["إسطنبول","أنقرة","أنطاليا","إزمير"],c:1},
{cat:"علوم",q:"ما أكثر عنصر وفرة في الكون؟",o:["أكسجين","كربون","هيليوم","هيدروجين"],c:3},
{cat:"علوم",q:"كم عدد عظام جسم الإنسان البالغ؟",o:["180","206","250","300"],c:1},
{cat:"علوم",q:"ما أقرب كوكب إلى الشمس؟",o:["الزهرة","المريخ","عطارد","الأرض"],c:2},
{cat:"علوم",q:"ما أكبر عضو في جسم الإنسان؟",o:["الكبد","الرئة","الجلد","المعدة"],c:2},
{cat:"علوم",q:"كم عدد الكواكب في المجموعة الشمسية؟",o:["7","8","9","10"],c:1},
{cat:"علوم",q:"ما درجة غليان الماء بالمئوية؟",o:["90","95","100","110"],c:2},
{cat:"علوم",q:"ما المعدن السائل في درجة حرارة الغرفة؟",o:["الذهب","الحديد","الزئبق","النحاس"],c:2},
{cat:"علوم",q:"ما الغاز الذي تمتصه النباتات؟",o:["الأكسجين","النيتروجين","ثاني أكسيد الكربون","الهيليوم"],c:2},
{cat:"تاريخ",q:"متى كانت معركة بدر؟",o:["1 هجري","2 هجري","3 هجري","4 هجري"],c:1},
{cat:"تاريخ",q:"من مؤسس الدولة الأموية؟",o:["عبد الملك","معاوية بن أبي سفيان","عمر بن عبد العزيز","يزيد"],c:1},
{cat:"تاريخ",q:"متى فُتحت القسطنطينية؟",o:["1453م","1492م","1389م","1520م"],c:0},
{cat:"تاريخ",q:"من فاتح مصر؟",o:["خالد بن الوليد","عمرو بن العاص","سعد بن أبي وقاص","طارق بن زياد"],c:1},
{cat:"تاريخ",q:"من بنى الأهرامات؟",o:["الرومان","الفراعنة","الفرس","اليونان"],c:1},
{cat:"تاريخ",q:"من أول خليفة في الإسلام؟",o:["عمر","أبو بكر الصديق","عثمان","علي"],c:1},
{cat:"رياضة",q:"كم لاعب في فريق كرة القدم؟",o:["9","10","11","12"],c:2},
{cat:"رياضة",q:"أين أُقيم مونديال 2022؟",o:["السعودية","الإمارات","قطر","البحرين"],c:2},
{cat:"رياضة",q:"كم مرة فازت البرازيل بكأس العالم؟",o:["3","4","5","6"],c:2},
{cat:"رياضة",q:"كم مدة شوط كرة القدم؟",o:["30 دقيقة","40 دقيقة","45 دقيقة","50 دقيقة"],c:2},
{cat:"ثقافة",q:"ما أكثر لغة تحدثاً في العالم؟",o:["الإنجليزية","الإسبانية","الصينية","العربية"],c:2},
{cat:"ثقافة",q:"كم لون في قوس قزح؟",o:["5","6","7","8"],c:2},
{cat:"ثقافة",q:"ما عملة اليابان؟",o:["اليوان","الين","الوون","الباهت"],c:1},
{cat:"إسلام",q:"كم عدد سور القرآن الكريم؟",o:["110","112","114","116"],c:2},
{cat:"إسلام",q:"كم عدد أركان الإسلام؟",o:["4","5","6","7"],c:1},
{cat:"إسلام",q:"ما أطول سورة في القرآن؟",o:["آل عمران","النساء","البقرة","الأعراف"],c:2},
{cat:"إسلام",q:"ما أول سورة نزلت؟",o:["الفاتحة","البقرة","العلق","المدثر"],c:2},
{cat:"تكنولوجيا",q:"من مؤسس مايكروسوفت؟",o:["ستيف جوبز","بيل غيتس","زوكربيرغ","ماسك"],c:1},
{cat:"تكنولوجيا",q:"في أي سنة صدر أول آيفون؟",o:["2005","2006","2007","2008"],c:2},
{cat:"تكنولوجيا",q:"ما أشهر لغة برمجة في العالم؟",o:["Java","Python","C++","Ruby"],c:1},
];

// ── Cards system ──
const CARDS = {
  fifty: { name: "❌ حذف خيارين", desc: "احذف خيارين خاطئين" },
  time: { name: "⏱️ وقت إضافي", desc: "+10 ثواني إضافية" },
  steal: { name: "🏴‍☠️ سرقة نقاط", desc: "اسرق 5 نقاط من الفريق الآخر" },
  double: { name: "⚡ مضاعفة", desc: "ضاعف نقاط السؤال" },
  shield: { name: "🛡️ درع", desc: "لا تخسر نقاط إذا أخطأت" },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function genCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (qaRooms.has(code));
  return code;
}

// ── Create QA session ──
function createSession(modSocketId, settings = {}) {
  const code = genCode();
  const room = {
    code,
    modSocketId,
    modName: settings.modName || "المشرف",
    state: "lobby", // lobby | playing | ended
    settings: {
      questionCount: settings.questionCount || 10,
      timePerQuestion: settings.timePerQuestion || 20,
      categories: settings.categories || [],
    },
    teams: {
      A: { name: "الفريق الأزرق", players: [], score: 0 },
      B: { name: "الفريق الأحمر", players: [], score: 0 },
    },
    spectators: [],
    questions: [],
    currentQuestion: -1,
    currentTurn: null, // { team: "A"|"B", playerIdx: 0 }
    turns: [],
    turnIdx: 0,
    timer: null,
    timeLeft: 0,
    answered: false,
    activeCard: null, // card being used this question
    gameStats: {},
    createdAt: Date.now(),
  };
  qaRooms.set(code, room);
  return room;
}

// ── Join session ──
function joinSession(code, name, team, socketId, asMod = false) {
  const room = qaRooms.get(code);
  if (!room) return { success: false, error: "الجلسة غير موجودة" };
  if (room.state === "ended") return { success: false, error: "الجلسة انتهت" };

  // Check reconnection
  const allPlayers = [...room.teams.A.players, ...room.teams.B.players];
  const existing = allPlayers.find(p => p.name === name);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    return { success: true, player: existing, reconnected: true };
  }

  if (team !== "A" && team !== "B") return { success: false, error: "فريق غير صالح" };
  if (room.teams[team].players.length >= 5) return { success: false, error: "الفريق ممتلئ" };

  const player = {
    name, team, socketId, connected: true, score: 0,
    wallet: ["fifty", "time", "steal", "double", "shield"], // available cards
    usedCard: false, // one card per session
    stats: { correct: 0, wrong: 0, streak: 0, maxStreak: 0 },
  };
  room.teams[team].players.push(player);
  room.gameStats[name] = player.stats;
  return { success: true, player, reconnected: false };
}

// ── Start game ──
function startSession(code) {
  const room = qaRooms.get(code);
  if (!room || room.state !== "lobby") return null;

  const aPlayers = room.teams.A.players.filter(p => p.connected);
  const bPlayers = room.teams.B.players.filter(p => p.connected);
  if (aPlayers.length < 1 || bPlayers.length < 1) return null;

  // Build questions
  let pool = QA_BANK;
  if (room.settings.categories.length > 0) {
    pool = pool.filter(q => room.settings.categories.includes(q.cat));
  }
  room.questions = shuffle(pool).slice(0, room.settings.questionCount);

  // Build turns (alternating teams, cycling players)
  room.turns = [];
  let aIdx = 0, bIdx = 0;
  for (let i = 0; i < room.questions.length; i++) {
    if (i % 2 === 0 && aPlayers.length > 0) {
      room.turns.push({ team: "A", playerIdx: aIdx % aPlayers.length });
      aIdx++;
    } else if (bPlayers.length > 0) {
      room.turns.push({ team: "B", playerIdx: bIdx % bPlayers.length });
      bIdx++;
    } else {
      room.turns.push({ team: "A", playerIdx: aIdx % aPlayers.length });
      aIdx++;
    }
  }

  room.state = "playing";
  room.currentQuestion = 0;
  room.turnIdx = 0;
  room.teams.A.score = 0;
  room.teams.B.score = 0;
  return room;
}

// ── Get current question (safe for players — no correct answer index) ──
function getQuestion(room) {
  if (room.currentQuestion < 0 || room.currentQuestion >= room.questions.length) return null;
  const q = room.questions[room.currentQuestion];
  const turn = room.turns[room.turnIdx];
  const team = room.teams[turn.team];
  const player = team.players[turn.playerIdx];
  const isBonus = room.currentQuestion >= room.questions.length - 2;
  return {
    cat: q.cat, q: q.q, options: q.o,
    index: room.currentQuestion, total: room.questions.length,
    turn: { team: turn.team, teamName: team.name, playerName: player.name },
    isBonus,
  };
}

// ── Answer question ──
function answerQuestion(code, socketId, optionIdx) {
  const room = qaRooms.get(code);
  if (!room || room.state !== "playing" || room.answered) return null;

  const turn = room.turns[room.turnIdx];
  const team = room.teams[turn.team];
  const player = team.players[turn.playerIdx];
  if (player.socketId !== socketId) return null; // Not this player's turn

  room.answered = true;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }

  const q = room.questions[room.currentQuestion];
  const correct = optionIdx === q.c;
  const isBonus = room.currentQuestion >= room.questions.length - 2;
  const mult = isBonus ? 3 : 1;
  let points = 0;

  if (correct) {
    points = (10 + room.timeLeft) * mult;
    if (room.activeCard === "double") points *= 2;
    team.score += points;
    player.score += points;
    player.stats.correct++;
    player.stats.streak++;
    if (player.stats.streak > player.stats.maxStreak) player.stats.maxStreak = player.stats.streak;
  } else {
    if (room.activeCard !== "shield") {
      // No penalty in this version, just no points
    }
    player.stats.wrong++;
    player.stats.streak = 0;
  }

  room.activeCard = null;

  return {
    correct, points, correctIdx: q.c,
    playerName: player.name, team: turn.team,
    scores: { A: room.teams.A.score, B: room.teams.B.score },
  };
}

// ── Use card ──
function useCard(code, socketId, cardType) {
  const room = qaRooms.get(code);
  if (!room || room.state !== "playing" || room.answered) return null;

  const turn = room.turns[room.turnIdx];
  const team = room.teams[turn.team];
  const player = team.players[turn.playerIdx];
  if (player.socketId !== socketId) return null;
  if (player.usedCard) return null; // One card per session
  if (!player.wallet.includes(cardType)) return null;

  player.usedCard = true;
  player.wallet = player.wallet.filter(c => c !== cardType);
  room.activeCard = cardType;

  const result = { card: cardType, playerName: player.name, team: turn.team };

  if (cardType === "fifty") {
    // Remove 2 wrong options
    const q = room.questions[room.currentQuestion];
    const wrong = [0, 1, 2, 3].filter(i => i !== q.c);
    const removed = shuffle(wrong).slice(0, 2);
    result.removedOptions = removed;
  } else if (cardType === "time") {
    room.timeLeft += 10;
    result.newTime = room.timeLeft;
  } else if (cardType === "steal") {
    const oppTeam = turn.team === "A" ? "B" : "A";
    const stolen = Math.min(5, room.teams[oppTeam].score);
    room.teams[oppTeam].score -= stolen;
    team.score += stolen;
    result.stolen = stolen;
    result.scores = { A: room.teams.A.score, B: room.teams.B.score };
  }
  // double and shield are passive — handled in answerQuestion

  return result;
}

// ── Next question ──
function nextQuestion(code) {
  const room = qaRooms.get(code);
  if (!room || room.state !== "playing") return null;

  room.turnIdx++;
  room.currentQuestion++;
  room.answered = false;
  room.activeCard = null;

  if (room.currentQuestion >= room.questions.length) {
    room.state = "ended";
    return { gameOver: true, scores: { A: room.teams.A.score, B: room.teams.B.score }, stats: room.gameStats };
  }

  return { gameOver: false, question: getQuestion(room) };
}

// ── Time up ──
function timeUp(code) {
  const room = qaRooms.get(code);
  if (!room || room.answered) return null;
  room.answered = true;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }

  const turn = room.turns[room.turnIdx];
  const player = room.teams[turn.team].players[turn.playerIdx];
  player.stats.wrong++;
  player.stats.streak = 0;
  room.activeCard = null;

  const q = room.questions[room.currentQuestion];
  return { playerName: player.name, team: turn.team, correctIdx: q.c };
}

// ── Accessors ──
function getSession(code) { return qaRooms.get(code) || null; }
function deleteSession(code) {
  const room = qaRooms.get(code);
  if (room && room.timer) clearInterval(room.timer);
  qaRooms.delete(code);
}

function getSessionInfo(room) {
  return {
    code: room.code, state: room.state, modName: room.modName,
    settings: room.settings,
    teams: {
      A: { name: room.teams.A.name, score: room.teams.A.score, players: room.teams.A.players.map(p => ({ name: p.name, score: p.score, connected: p.connected, usedCard: p.usedCard })) },
      B: { name: room.teams.B.name, score: room.teams.B.score, players: room.teams.B.players.map(p => ({ name: p.name, score: p.score, connected: p.connected, usedCard: p.usedCard })) },
    },
    playerCount: room.teams.A.players.filter(p => p.connected).length + room.teams.B.players.filter(p => p.connected).length,
  };
}

function getPlayerCards(code, socketId) {
  const room = qaRooms.get(code);
  if (!room) return [];
  const all = [...room.teams.A.players, ...room.teams.B.players];
  const player = all.find(p => p.socketId === socketId);
  return player ? { wallet: player.wallet, usedCard: player.usedCard } : { wallet: [], usedCard: true };
}

function getCategories() {
  return [...new Set(QA_BANK.map(q => q.cat))];
}

module.exports = {
  createSession, joinSession, startSession,
  getQuestion, answerQuestion, useCard, nextQuestion, timeUp,
  getSession, deleteSession, getSessionInfo, getPlayerCards, getCategories,
  CARDS,
};
