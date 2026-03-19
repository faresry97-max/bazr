// ─── index.js ─── Express + Socket.io server ───

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const gm = require("./gameManager");

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
  // ║       Admin Dashboard Events   ║
  // ══════════════════════════════════

  socket.on("admin-get-stats", (data, cb) => {
    const allRooms = gm.getAllRoomInfo();
    const totalPlayers = allRooms.reduce((s, r) => s + r.playerCount, 0);
    cb({
      online: gm.getOnlineCount(),
      roomCount: gm.getRoomCount(),
      totalPlayers,
      questionCount: gm.getQuestionCount(),
      rooms: allRooms,
      leaderboard: gm.getLeaderboard("monthly"),
    });
  });

  socket.on("admin-delete-room", (data, cb) => {
    const room = gm.getRoom(data.code);
    if (room) {
      io.to(`room:${data.code}`).emit("host-disconnected");
      gm.deleteRoom(data.code);
      cb({ success: true });
    } else { cb({ success: false }); }
  });

  socket.on("admin-clear-rooms", (data, cb) => {
    const rooms = gm.getAllRoomInfo();
    rooms.forEach(r => {
      io.to(`room:${r.code}`).emit("host-disconnected");
      gm.deleteRoom(r.code);
    });
    cb({ success: true });
  });

  socket.on("admin-clear-leaderboard", (data, cb) => {
    gm.clearLeaderboard();
    cb({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🎮 بازر server running on http://localhost:${PORT}\n`));
