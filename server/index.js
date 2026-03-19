// ─── index.js ─── Express + Socket.io server ───

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const gm = require("./gameManager");
const qa = require("./qaGame");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingInterval: 10000, pingTimeout: 5000 });

const publicPath = path.join(__dirname, "..", "public");
console.log("Serving static files from:", publicPath);
app.use(express.static(publicPath));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// Broadcast online count to everyone every 5 seconds
setInterval(() => {
  io.emit("global-stats", { online: gm.getOnlineCount(), rooms: gm.getRoomCount() });
}, 5000);

io.on("connection", (socket) => {
  const online = gm.incrementOnline();
  io.emit("global-stats", { online, rooms: gm.getRoomCount() });

  // ── Categories ──
  socket.on("get-categories", (cb) => cb(gm.getAvailableCategories()));

  // ── Leaderboard ──
  socket.on("get-leaderboard", (data, cb) => {
    cb(gm.getLeaderboard(data?.period || "daily"));
  });

  // ── Create Room ──
  socket.on("create-room", (data, cb) => {
    const room = gm.createRoom(socket.id, {
      categories: data?.categories || [],
      questionCount: data?.questionCount || 20,
    });
    socket.join(`room:${room.code}`);
    socket.join(`host:${room.code}`);
    cb({ success: true, roomCode: room.code, settings: room.settings });
  });

  // ── Update Settings ──
  socket.on("update-settings", (data) => gm.updateSettings(data.roomCode, data.settings));

  // ── Join Room ──
  socket.on("join-room", (data, cb) => {
    const { roomCode, name, team } = data;
    const result = gm.addPlayer(roomCode, name, team, socket.id);
    if (!result.success) return cb({ success: false, error: result.error });

    socket.join(`room:${roomCode}`);
    socket.data.roomCode = roomCode;
    socket.data.playerName = name;
    socket.data.playerTeam = team;

    const room = gm.getRoom(roomCode);
    const info = gm.getPlayerInfo(room);
    cb({ success: true, player: result.player, reconnected: result.reconnected, gameState: room.state, scores: gm.getScores(room) });
    io.to(`room:${roomCode}`).emit("player-update", info);

    if (result.reconnected && room.state === "playing") {
      const q = gm.getCurrentQuestion(room);
      if (q) socket.emit("new-question", q);
      if (room.buzzedPlayer) socket.emit("buzzer-locked", { winnerName: room.buzzedPlayer.name, winnerTeam: room.buzzedPlayer.team });
      else if (room.buzzerOpen) socket.emit("buzzer-open");
      socket.emit("score-update", gm.getScores(room));
    }
  });

  // ── Chat ──
  socket.on("chat-msg", (data) => {
    const { roomCode, msg } = data;
    const name = socket.data.playerName || "مقدّم";
    const team = socket.data.playerTeam || "host";
    const entry = gm.addChatMessage(roomCode, name, team, msg);
    if (entry) io.to(`room:${roomCode}`).emit("chat-msg", entry);
  });

  // ── Reaction ──
  socket.on("reaction", (data) => {
    const { roomCode, emoji } = data;
    const name = socket.data.playerName || "مقدّم";
    const team = socket.data.playerTeam || "host";
    const entry = gm.addReaction(roomCode, name, team, emoji);
    if (entry) io.to(`room:${roomCode}`).emit("chat-msg", entry);
  });

  // ── Kick ──
  socket.on("kick-player", (data) => {
    const result = gm.kickPlayer(data.roomCode, data.playerId);
    if (!result) return;
    const kicked = [...io.sockets.sockets.values()].find(
      s => s.data.playerName === result.player.name && s.data.roomCode === data.roomCode
    );
    if (kicked) { kicked.emit("kicked"); kicked.leave(`room:${data.roomCode}`); }
    io.to(`room:${data.roomCode}`).emit("player-update", gm.getPlayerInfo(gm.getRoom(data.roomCode)));
  });

  // ── Start Game ──
  socket.on("start-game", (data) => {
    const room = gm.startGame(data.roomCode);
    if (!room) return;
    io.to(`host:${data.roomCode}`).emit("game-started", { question: gm.getCurrentQuestionFull(room), scores: gm.getScores(room) });
    room.players.forEach(p => {
      if (p.connected) io.to(p.socketId).emit("game-started", { question: gm.getCurrentQuestion(room), scores: gm.getScores(room) });
    });
  });

  // ── Open Buzzer ──
  socket.on("open-buzzer", (data) => {
    if (gm.openBuzzer(data.roomCode)) io.to(`room:${data.roomCode}`).emit("buzzer-open");
  });

  // ── Buzz ──
  socket.on("buzz", (data) => {
    const result = gm.handleBuzz(data.roomCode, socket.id);
    if (!result.success) return;
    const room = gm.getRoom(data.roomCode);
    io.to(`room:${data.roomCode}`).emit("buzzer-locked", { winnerName: result.player.name, winnerTeam: result.player.team });

    room.timerRemaining = room.settings.timerDuration;
    room.timer = setInterval(() => {
      room.timerRemaining -= 1;
      io.to(`room:${data.roomCode}`).emit("timer-tick", { remaining: room.timerRemaining });
      if (room.timerRemaining <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        io.to(`room:${data.roomCode}`).emit("timer-expired");
        const jr = gm.judgeAnswer(data.roomCode, false);
        if (jr) {
          const fq = gm.getCurrentQuestionFull(room);
          jr.correctAnswer = fq ? fq.answer : "";
          io.to(`room:${data.roomCode}`).emit("answer-result", jr);
          io.to(`room:${data.roomCode}`).emit("score-update", jr.scores);
        }
      }
    }, 1000);
  });

  // ── Submit Answer ──
  socket.on("submit-answer", (data) => {
    const room = gm.getRoom(data.roomCode);
    if (room?.timer) { clearInterval(room.timer); room.timer = null; }
    const result = gm.submitAnswer(data.roomCode, socket.id, data.answer);
    if (!result) return;
    io.to(`room:${data.roomCode}`).emit("answer-result", result);
    io.to(`room:${data.roomCode}`).emit("score-update", result.scores);
    io.to(`room:${data.roomCode}`).emit("player-update", gm.getPlayerInfo(room));
  });

  // ── Host Override ──
  socket.on("judge-override", (data) => {
    const room = gm.getRoom(data.roomCode);
    if (room?.timer) { clearInterval(room.timer); room.timer = null; }
    const result = gm.judgeAnswer(data.roomCode, data.correct);
    if (!result) return;
    const fq = gm.getCurrentQuestionFull(room);
    result.correctAnswer = fq ? fq.answer : "";
    result.override = true;
    io.to(`room:${data.roomCode}`).emit("answer-result", result);
    io.to(`room:${data.roomCode}`).emit("score-update", result.scores);
    io.to(`room:${data.roomCode}`).emit("player-update", gm.getPlayerInfo(room));
  });

  // ── Next Question ──
  socket.on("next-question", (data) => {
    const result = gm.nextQuestion(data.roomCode);
    if (!result) return;
    if (result.gameOver) {
      io.to(`room:${data.roomCode}`).emit("game-over", {
        scores: result.scores,
        winner: result.scores.A > result.scores.B ? "A" : result.scores.B > result.scores.A ? "B" : "tie",
      });
      return;
    }
    const room = gm.getRoom(data.roomCode);
    io.to(`host:${data.roomCode}`).emit("new-question", gm.getCurrentQuestionFull(room));
    room.players.forEach(p => { if (p.connected) io.to(p.socketId).emit("new-question", result.question); });
  });

  // ── Skip ──
  socket.on("skip-question", (data) => {
    const result = gm.skipQuestion(data.roomCode);
    if (!result) return;
    const room = gm.getRoom(data.roomCode);
    const fq = gm.getCurrentQuestionFull(room);
    io.to(`room:${data.roomCode}`).emit("question-skipped", { correctAnswer: fq ? fq.answer : "" });
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    const online = gm.decrementOnline();
    io.emit("global-stats", { online, rooms: gm.getRoomCount() });

    const hostRoom = gm.getRoomByHost(socket.id);
    if (hostRoom) {
      io.to(`room:${hostRoom.code}`).emit("host-disconnected");
      setTimeout(() => {
        const room = gm.getRoom(hostRoom.code);
        if (room && room.hostSocketId === socket.id) gm.deleteRoom(hostRoom.code);
      }, 5 * 60 * 1000);
    }

    const result = gm.disconnectPlayer(socket.id);
    if (result) io.to(`room:${result.room.code}`).emit("player-update", gm.getPlayerInfo(result.room));
  });

  // ── Host Reconnect ──
  socket.on("host-reconnect", (data, cb) => {
    const room = gm.getRoom(data.roomCode);
    if (!room) return cb({ success: false, error: "الغرفة غير موجودة" });
    room.hostSocketId = socket.id;
    socket.join(`room:${data.roomCode}`);
    socket.join(`host:${data.roomCode}`);
    socket.data.roomCode = data.roomCode;
    cb({
      success: true, state: room.state, players: gm.getPlayerInfo(room), scores: gm.getScores(room),
      question: room.state === "playing" ? gm.getCurrentQuestionFull(room) : null,
      buzzedPlayer: room.buzzedPlayer, settings: room.settings,
    });
  });

  // ══════════════════════════════════
  // ║    Q&A Game Mode Events        ║
  // ══════════════════════════════════

  socket.on("qa-create", (d, cb) => {
    const room = qa.createSession(socket.id, d);
    socket.join(`qa:${room.code}`);
    socket.data.qaRoom = room.code;
    socket.data.qaRole = "mod";
    cb({ success: true, code: room.code, categories: qa.getCategories() });
  });

  socket.on("qa-join", (d, cb) => {
    const result = qa.joinSession(d.code, d.name, d.team, socket.id);
    if (!result.success) return cb(result);
    socket.join(`qa:${d.code}`);
    socket.data.qaRoom = d.code;
    socket.data.qaRole = "player";
    socket.data.qaName = d.name;
    const room = qa.getSession(d.code);
    cb({ success: true, player: result.player, reconnected: result.reconnected, info: qa.getSessionInfo(room), cards: qa.getPlayerCards(d.code, socket.id) });
    io.to(`qa:${d.code}`).emit("qa-update", qa.getSessionInfo(room));
  });

  socket.on("qa-start", (d) => {
    const room = qa.startSession(d.code);
    if (!room) return;
    const q = qa.getQuestion(room);
    io.to(`qa:${d.code}`).emit("qa-started", { question: q, info: qa.getSessionInfo(room) });
  });

  socket.on("qa-answer", (d) => {
    const result = qa.answerQuestion(d.code, socket.id, d.optionIdx);
    if (!result) return;
    io.to(`qa:${d.code}`).emit("qa-answered", result);
  });

  socket.on("qa-use-card", (d) => {
    const result = qa.useCard(d.code, socket.id, d.card);
    if (!result) return;
    io.to(`qa:${d.code}`).emit("qa-card-used", result);
  });

  socket.on("qa-next", (d) => {
    const result = qa.nextQuestion(d.code);
    if (!result) return;
    if (result.gameOver) {
      const w = result.scores.A > result.scores.B ? "A" : result.scores.B > result.scores.A ? "B" : "tie";
      io.to(`qa:${d.code}`).emit("qa-ended", { scores: result.scores, winner: w });
    } else {
      io.to(`qa:${d.code}`).emit("qa-question", result.question);
    }
  });

  socket.on("qa-timer-start", (d) => {
    const room = qa.getSession(d.code);
    if (!room) return;
    room.timeLeft = room.settings.timePerQuestion;
    room.timer = setInterval(() => {
      room.timeLeft--;
      io.to(`qa:${d.code}`).emit("qa-tick", { time: room.timeLeft });
      if (room.timeLeft <= 0) {
        clearInterval(room.timer); room.timer = null;
        const result = qa.timeUp(d.code);
        if (result) io.to(`qa:${d.code}`).emit("qa-timeup", result);
      }
    }, 1000);
  });

  socket.on("qa-get-cards", (d, cb) => { cb(qa.getPlayerCards(d.code, socket.id)); });
  socket.on("qa-get-categories", (d, cb) => { cb(qa.getCategories()); });

  // ══════════════════════════════════
  // ║       Admin Dashboard Events   ║
  // ══════════════════════════════════

  socket.on("admin-stats", (d, cb) => cb(gm.getFullStats()));

  socket.on("admin-get-questions", (d, cb) => {
    cb({ questions: gm.getQuestionSample(), categories: gm.getAvailableCategories() });
  });

  socket.on("admin-add-question", (d, cb) => {
    const q = gm.adminAddQuestion(d);
    gm.addLog("add-question", q.q);
    cb({ success: true, question: q });
  });

  socket.on("admin-edit-question", (d, cb) => {
    const q = gm.adminEditQuestion(d.id, d.updates);
    if (q) { gm.addLog("edit-question", q.q); cb({ success: true }); }
    else cb({ success: false });
  });

  socket.on("admin-delete-question", (d, cb) => {
    if (gm.adminDeleteQuestion(d.id)) { gm.addLog("delete-question", "ID:" + d.id); cb({ success: true }); }
    else cb({ success: false });
  });

  socket.on("admin-bulk-import", (d, cb) => {
    const count = gm.adminBulkImport(d.questions || []);
    gm.addLog("bulk-import", count + " questions");
    cb({ success: true, count });
  });

  socket.on("admin-delete-room", (d, cb) => {
    const room = gm.getRoom(d.code);
    if (room) {
      io.to(`room:${d.code}`).emit("host-disconnected");
      gm.deleteRoom(d.code);
      gm.addLog("delete-room", d.code);
      cb({ success: true });
    } else cb({ success: false });
  });

  socket.on("admin-force-close", (d, cb) => {
    if (gm.forceCloseRoom(d.code)) {
      io.to(`room:${d.code}`).emit("game-over", { scores: { A: 0, B: 0, players: [] }, winner: "tie" });
      gm.addLog("force-close", d.code);
      cb({ success: true });
    } else cb({ success: false });
  });

  socket.on("admin-clear-rooms", (d, cb) => {
    gm.getAllRoomInfo().forEach(r => {
      io.to(`room:${r.code}`).emit("host-disconnected");
      gm.deleteRoom(r.code);
    });
    gm.addLog("clear-all-rooms", "");
    cb({ success: true });
  });

  socket.on("admin-kick-player", (d, cb) => {
    const result = gm.adminKickPlayer(d.roomCode, d.playerName);
    if (result) {
      const s = [...io.sockets.sockets.values()].find(s => s.data.playerName === d.playerName && s.data.roomCode === d.roomCode);
      if (s) { s.emit("kicked"); s.leave(`room:${d.roomCode}`); }
      io.to(`room:${d.roomCode}`).emit("player-update", gm.getPlayerInfo(result.room));
      gm.addLog("kick-player", d.playerName + " from " + d.roomCode);
      cb({ success: true });
    } else cb({ success: false });
  });

  socket.on("admin-clear-leaderboard", (d, cb) => {
    gm.clearLeaderboard();
    gm.addLog("clear-leaderboard", "");
    cb({ success: true });
  });

  socket.on("admin-get-logs", (d, cb) => cb(gm.getLogs(d.limit || 100)));
  socket.on("admin-clear-logs", (d, cb) => { gm.clearLogs(); cb({ success: true }); });

  socket.on("admin-get-players", (d, cb) => cb(gm.getAllPlayers()));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎮 بازر server running on http://localhost:${PORT}\n`));
