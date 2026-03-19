// ─── index.js ─── Express + Socket.io server ───

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const gm = require("./gameManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Socket.io ───
io.on("connection", (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  // ── Get available categories ──
  socket.on("get-categories", (callback) => {
    callback(gm.getAvailableCategories());
  });

  // ── Host: Create Room ──
  socket.on("create-room", (data, callback) => {
    const options = {
      categories: data?.categories || [],
      questionCount: data?.questionCount || 20,
    };
    const room = gm.createRoom(socket.id, options);
    socket.join(`room:${room.code}`);
    socket.join(`host:${room.code}`);
    console.log(`🏠 Room created: ${room.code}`);
    callback({
      success: true,
      roomCode: room.code,
      settings: room.settings,
    });
  });

  // ── Host: Update Settings ──
  socket.on("update-settings", (data) => {
    const { roomCode, settings } = data;
    gm.updateSettings(roomCode, settings);
  });

  // ── Player: Join Room ──
  socket.on("join-room", (data, callback) => {
    const { roomCode, name, team } = data;
    const result = gm.addPlayer(roomCode, name, team, socket.id);

    if (!result.success) {
      callback({ success: false, error: result.error });
      return;
    }

    socket.join(`room:${roomCode}`);
    socket.data.roomCode = roomCode;
    socket.data.playerName = name;

    const room = gm.getRoom(roomCode);
    const info = gm.getPlayerInfo(room);

    callback({
      success: true,
      player: result.player,
      reconnected: result.reconnected,
      gameState: room.state,
      scores: gm.getScores(room),
    });

    io.to(`room:${roomCode}`).emit("player-update", info);

    // Reconnection mid-game: send current state
    if (result.reconnected && room.state === "playing") {
      const q = gm.getCurrentQuestion(room);
      if (q) socket.emit("new-question", q);
      if (room.buzzedPlayer) {
        socket.emit("buzzer-locked", {
          winnerName: room.buzzedPlayer.name,
          winnerTeam: room.buzzedPlayer.team,
        });
      } else if (room.buzzerOpen) {
        socket.emit("buzzer-open");
      }
      socket.emit("score-update", gm.getScores(room));
    }

    console.log(`👤 ${name} joined room ${roomCode} (Team ${team})${result.reconnected ? " [reconnected]" : ""}`);
  });

  // ── Host: Kick Player ──
  socket.on("kick-player", (data) => {
    const { roomCode, playerId } = data;
    const result = gm.kickPlayer(roomCode, playerId);
    if (!result) return;

    // Notify kicked player
    const kickedSocket = [...io.sockets.sockets.values()].find(
      (s) => s.data.playerName === result.player.name && s.data.roomCode === roomCode
    );
    if (kickedSocket) {
      kickedSocket.emit("kicked");
      kickedSocket.leave(`room:${roomCode}`);
    }

    const room = gm.getRoom(roomCode);
    io.to(`room:${roomCode}`).emit("player-update", gm.getPlayerInfo(room));
    console.log(`🚫 ${result.player.name} kicked from room ${roomCode}`);
  });

  // ── Host: Start Game ──
  socket.on("start-game", (data) => {
    const { roomCode } = data;
    const room = gm.startGame(roomCode);
    if (!room) return;

    const questionFull = gm.getCurrentQuestionFull(room);
    const questionForPlayers = gm.getCurrentQuestion(room);

    io.to(`host:${roomCode}`).emit("game-started", {
      question: questionFull,
      scores: gm.getScores(room),
    });

    room.players.forEach((p) => {
      if (p.connected) {
        io.to(p.socketId).emit("game-started", {
          question: questionForPlayers,
          scores: gm.getScores(room),
        });
      }
    });

    console.log(`🎮 Game started in room ${roomCode} (${room.questions.length} questions)`);
  });

  // ── Host: Open Buzzer ──
  socket.on("open-buzzer", (data) => {
    const { roomCode } = data;
    if (gm.openBuzzer(roomCode)) {
      io.to(`room:${roomCode}`).emit("buzzer-open");
    }
  });

  // ── Player: Buzz ──
  socket.on("buzz", (data) => {
    const { roomCode } = data;
    const result = gm.handleBuzz(roomCode, socket.id);
    if (!result.success) return;

    const room = gm.getRoom(roomCode);

    io.to(`room:${roomCode}`).emit("buzzer-locked", {
      winnerName: result.player.name,
      winnerTeam: result.player.team,
    });

    // Start 15-second countdown
    room.timerRemaining = room.settings.timerDuration;
    room.timer = setInterval(() => {
      room.timerRemaining -= 1;
      io.to(`room:${roomCode}`).emit("timer-tick", { remaining: room.timerRemaining });

      if (room.timerRemaining <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        io.to(`room:${roomCode}`).emit("timer-expired");
        // Auto-judge as wrong (time ran out)
        const judgeResult = gm.judgeAnswer(roomCode, false);
        if (judgeResult) {
          const fullQ = gm.getCurrentQuestionFull(room);
          judgeResult.correctAnswer = fullQ ? fullQ.answer : "";
          io.to(`room:${roomCode}`).emit("answer-result", judgeResult);
          io.to(`room:${roomCode}`).emit("score-update", judgeResult.scores);
        }
      }
    }, 1000);

    console.log(`🔴 ${result.player.name} buzzed in room ${roomCode}`);
  });

  // ── Player: Submit Answer ──
  socket.on("submit-answer", (data) => {
    const { roomCode, answer } = data;
    const room = gm.getRoom(roomCode);

    // Clear timer since answer was submitted
    if (room && room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }

    const result = gm.submitAnswer(roomCode, socket.id, answer);
    if (!result) return;

    io.to(`room:${roomCode}`).emit("answer-result", result);
    io.to(`room:${roomCode}`).emit("score-update", result.scores);
    io.to(`room:${roomCode}`).emit("player-update", gm.getPlayerInfo(room));

    console.log(`📝 ${result.playerName}: "${answer}" → ${result.correct ? "✅" : "❌"} (${result.similarity}%)`);
  });

  // ── Host: Manual Judge Override ──
  socket.on("judge-override", (data) => {
    const { roomCode, correct } = data;
    const room = gm.getRoom(roomCode);

    if (room && room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }

    const result = gm.judgeAnswer(roomCode, correct);
    if (!result) return;

    const fullQ = gm.getCurrentQuestionFull(room);
    result.correctAnswer = fullQ ? fullQ.answer : "";
    result.override = true;

    io.to(`room:${roomCode}`).emit("answer-result", result);
    io.to(`room:${roomCode}`).emit("score-update", result.scores);
    io.to(`room:${roomCode}`).emit("player-update", gm.getPlayerInfo(room));

    console.log(`⚖️ Host override: ${result.playerName} → ${correct ? "✅" : "❌"}`);
  });

  // ── Host: Next Question ──
  socket.on("next-question", (data) => {
    const { roomCode } = data;
    const result = gm.nextQuestion(roomCode);
    if (!result) return;

    if (result.gameOver) {
      io.to(`room:${roomCode}`).emit("game-over", {
        scores: result.scores,
        winner: result.scores.A > result.scores.B ? "A" : result.scores.B > result.scores.A ? "B" : "tie",
      });
      console.log(`🏁 Game over in room ${roomCode}`);
      return;
    }

    const room = gm.getRoom(roomCode);
    const fullQuestion = gm.getCurrentQuestionFull(room);

    io.to(`host:${roomCode}`).emit("new-question", fullQuestion);

    room.players.forEach((p) => {
      if (p.connected) {
        io.to(p.socketId).emit("new-question", result.question);
      }
    });
  });

  // ── Host: Skip Question ──
  socket.on("skip-question", (data) => {
    const { roomCode } = data;
    const result = gm.skipQuestion(roomCode);
    if (!result) return;

    const room = gm.getRoom(roomCode);
    const fullQ = gm.getCurrentQuestionFull(room);
    io.to(`room:${roomCode}`).emit("question-skipped", {
      correctAnswer: fullQ ? fullQ.answer : "",
    });
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    const hostRoom = gm.getRoomByHost(socket.id);
    if (hostRoom) {
      console.log(`🏠 Host disconnected from room ${hostRoom.code}`);
      io.to(`room:${hostRoom.code}`).emit("host-disconnected");
      setTimeout(() => {
        const room = gm.getRoom(hostRoom.code);
        if (room && room.hostSocketId === socket.id) {
          gm.deleteRoom(hostRoom.code);
          console.log(`🗑️ Room ${hostRoom.code} cleaned up`);
        }
      }, 5 * 60 * 1000);
    }

    const result = gm.disconnectPlayer(socket.id);
    if (result) {
      const info = gm.getPlayerInfo(result.room);
      io.to(`room:${result.room.code}`).emit("player-update", info);
      console.log(`👤 ${result.player.name} disconnected from room ${result.room.code}`);
    }
  });

  // ── Host: Reconnect ──
  socket.on("host-reconnect", (data, callback) => {
    const { roomCode } = data;
    const room = gm.getRoom(roomCode);
    if (!room) {
      callback({ success: false, error: "الغرفة غير موجودة" });
      return;
    }

    room.hostSocketId = socket.id;
    socket.join(`room:${roomCode}`);
    socket.join(`host:${roomCode}`);

    callback({
      success: true,
      state: room.state,
      players: gm.getPlayerInfo(room),
      scores: gm.getScores(room),
      question: room.state === "playing" ? gm.getCurrentQuestionFull(room) : null,
      buzzedPlayer: room.buzzedPlayer,
      settings: room.settings,
    });

    console.log(`🏠 Host reconnected to room ${roomCode}`);
  });
});

// ─── Start ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 بازر server running on http://localhost:${PORT}\n`);
});
