// ─── host.js ─── Host socket logic ───

const socket = io();
const params = new URLSearchParams(window.location.search);
const roomCode = params.get("room");

if (!roomCode) window.location.href = "/";

let gameActive = false;
let currentQuestion = null;
let buzzedPlayer = null;
let lastAnswerResult = null;

const $ = (id) => document.getElementById(id);

// ─── Initialize ───
socket.emit("host-reconnect", { roomCode }, (res) => {
  if (!res.success) {
    alert("الغرفة غير موجودة");
    window.location.href = "/";
    return;
  }
  $("lobby-code").textContent = roomCode;
  if (res.state === "playing") {
    gameActive = true;
    showScreen("sc-game");
    if (res.question) showQuestion(res.question);
    if (res.scores) updateScores(res.scores);
    if (res.buzzedPlayer) handleBuzzIn(res.buzzedPlayer);
    updatePlayerList(res.players);
  } else {
    updatePlayerList(res.players);
  }
});

// ─── Events ───

socket.on("player-update", (info) => {
  $("player-count").textContent = info.count;
  updatePlayerList(info);
});

socket.on("game-started", (data) => {
  gameActive = true;
  showScreen("sc-game");
  showQuestion(data.question);
  updateScores(data.scores);
  resetBuzzState();
});

socket.on("buzzer-open", () => {
  $("buzz-status").className = "buzz-status open";
  $("buzz-status").innerHTML = '<div style="color:var(--lime);font-size:20px;font-weight:900">🟢 الجرس مفتوح!</div><div class="text-dim" style="font-size:13px">بانتظار أول ضغطة...</div>';
  $("open-buzz-btn").disabled = true;
  $("answer-result").classList.add("hidden");
  $("judge-override").classList.add("hidden");
  buzzedPlayer = null;
});

socket.on("buzzer-locked", (data) => handleBuzzIn(data));

socket.on("timer-tick", (data) => updateTimer(data.remaining));

socket.on("timer-expired", () => {
  $("timer-text").textContent = "⏰";
  $("timer-text").classList.add("danger");
});

socket.on("answer-result", (data) => {
  lastAnswerResult = data;
  $("timer-section").classList.add("hidden");

  const icon = data.correct ? "✅" : "❌";
  const color = data.correct ? "var(--lime)" : "var(--red)";
  const label = data.correct ? "إجابة صحيحة!" : "إجابة خاطئة";

  $("buzz-status").innerHTML = `<div style="color:${color};font-size:20px;font-weight:900">${icon} ${label}</div><div style="font-size:14px;color:var(--mid)">${data.playerName}</div>`;

  // Show answer details
  const ar = $("answer-result");
  ar.classList.remove("hidden");
  ar.innerHTML = `
    <div class="ar-row"><span class="ar-label">الإجابة المقدّمة:</span> <span style="color:${color};font-weight:700">${data.submittedAnswer || "—"}</span></div>
    <div class="ar-row"><span class="ar-label">الإجابة الصحيحة:</span> <span style="color:var(--gold);font-weight:700">${data.correctAnswer || currentQuestion?.answer || ""}</span></div>
    ${data.similarity !== undefined ? `<div class="ar-row"><span class="ar-label">التطابق:</span> <span>${data.similarity}%</span></div>` : ""}
  `;

  // Show host override option
  if (!data.override) {
    $("judge-override").classList.remove("hidden");
  }

  // Show answer in question card
  if (currentQuestion?.answer) {
    $("q-answer").textContent = "الإجابة: " + currentQuestion.answer;
    $("q-answer").classList.add("visible");
  }

  if (data.correct) spawnScorePop(data.team);
  $("open-buzz-btn").disabled = false;
  buzzedPlayer = null;
});

socket.on("question-skipped", (data) => {
  if (data.correctAnswer) {
    $("q-answer").textContent = "الإجابة: " + data.correctAnswer;
    $("q-answer").classList.add("visible");
  }
  $("buzz-status").innerHTML = '<div style="color:var(--mid);font-size:16px">⏭️ تم تخطّي السؤال</div>';
  $("timer-section").classList.add("hidden");
  $("open-buzz-btn").disabled = false;
  buzzedPlayer = null;
});

socket.on("new-question", (data) => {
  showQuestion(data);
  resetBuzzState();
});

socket.on("score-update", (scores) => updateScores(scores));

socket.on("game-over", (data) => {
  sessionStorage.setItem("bazr-results", JSON.stringify(data));
  window.location.href = "/results.html";
});

// ─── Actions ───

function startGame() { socket.emit("start-game", { roomCode }); }
function openBuzzer() { socket.emit("open-buzzer", { roomCode }); }
function nextQuestion() { socket.emit("next-question", { roomCode }); }
function skipQuestion() { socket.emit("skip-question", { roomCode }); }

function judgeOverride(correct) {
  socket.emit("judge-override", { roomCode, correct });
  $("judge-override").classList.add("hidden");
}

function kickPlayer(playerId) {
  if (confirm("هل تريد طرد هذا اللاعب؟")) {
    socket.emit("kick-player", { roomCode, playerId });
  }
}

// ─── UI Helpers ───

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

function showQuestion(q) {
  currentQuestion = q;
  $("q-cat").textContent = q.cat || "";
  $("q-progress").textContent = `${q.index + 1} / ${q.total}`;
  $("q-text").textContent = q.text;
  $("q-answer").textContent = "";
  $("q-answer").classList.remove("visible");
  $("open-buzz-btn").disabled = false;
}

function resetBuzzState() {
  buzzedPlayer = null;
  lastAnswerResult = null;
  $("buzz-status").className = "buzz-status";
  $("buzz-status").innerHTML = '<div class="text-dim">⏳ بانتظار فتح الجرس...</div>';
  $("timer-section").classList.add("hidden");
  $("timer-text").classList.remove("danger");
  $("answer-result").classList.add("hidden");
  $("judge-override").classList.add("hidden");
}

function handleBuzzIn(data) {
  buzzedPlayer = data;
  const teamClass = data.winnerTeam === "A" ? "locked-a" : "locked-b";
  const teamColor = data.winnerTeam === "A" ? "var(--tA)" : "var(--tB)";
  const teamLabel = data.winnerTeam === "A" ? "الفريق أ" : "الفريق ب";

  $("buzz-status").className = "buzz-status " + teamClass;
  $("buzz-status").innerHTML = `<div class="buzz-name" style="color:${teamColor}">🎤 ${data.winnerName}</div><div class="buzz-team-label" style="color:${teamColor}">${teamLabel} — يكتب إجابته...</div>`;

  $("timer-section").classList.remove("hidden");
  $("open-buzz-btn").disabled = true;
  $("answer-result").classList.add("hidden");
  $("judge-override").classList.add("hidden");

  showBuzzFlash(data.winnerTeam);
}

function updateTimer(remaining) {
  const pct = (remaining / 15) * 100;
  const bar = $("timer-bar");
  const text = $("timer-text");
  bar.style.width = pct + "%";
  text.textContent = remaining;
  bar.classList.remove("warn", "danger");
  text.classList.remove("danger");
  if (remaining <= 3) { bar.classList.add("danger"); text.classList.add("danger"); }
  else if (remaining <= 7) { bar.classList.add("warn"); }
}

function updateScores(scores) {
  $("score-a").textContent = scores.A;
  $("score-b").textContent = scores.B;
}

function updatePlayerList(info) {
  const players = info.players || [];
  const count = info.count || players.filter(p => p.connected).length;
  $("player-count").textContent = count;

  const teamA = players.filter(p => p.team === "A");
  const teamB = players.filter(p => p.team === "B");

  const renderTeam = (list) => list.length
    ? list.map(p => `<div class="lobby-player ${p.connected ? "" : "offline"}">
        <span class="lobby-dot ${p.connected ? "on" : "off"}"></span>
        <span>${p.name}</span>
        ${!gameActive ? `<button class="kick-btn" onclick="kickPlayer('${p.id}')" title="طرد">✕</button>` : ""}
      </div>`).join("")
    : '<div class="text-dim" style="font-size:14px">بانتظار لاعبين...</div>';

  if ($("lobby-team-a")) $("lobby-team-a").innerHTML = renderTeam(teamA);
  if ($("lobby-team-b")) $("lobby-team-b").innerHTML = renderTeam(teamB);

  if ($("start-btn")) {
    const connectedCount = players.filter(p => p.connected).length;
    $("start-btn").disabled = connectedCount < 1;
    if (connectedCount > 0) $("lobby-hint").textContent = `${connectedCount} لاعب جاهز — يمكنك البدء!`;
  }

  if ($("game-players")) {
    $("game-players").innerHTML = players.map(p => {
      const dot = p.connected ? "online" : "offline";
      const badge = p.team === "A" ? "a" : "b";
      return `<li class="player-row">
        <span class="player-dot ${dot}"></span>
        <span class="player-name">${p.name}</span>
        <span class="player-team-badge ${badge}">${p.team === "A" ? "أ" : "ب"}</span>
        <span style="font-weight:700;color:var(--gold)">${p.score || 0}</span>
        <button class="kick-btn" onclick="kickPlayer('${p.id}')" title="طرد">✕</button>
      </li>`;
    }).join("");
  }
}

function showBuzzFlash(team) {
  const el = document.createElement("div");
  el.className = "buzz-flash " + (team === "A" ? "team-a" : "team-b");
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function spawnScorePop(team) {
  const card = team === "A" ? $("score-a") : $("score-b");
  const pop = document.createElement("div");
  pop.className = "score-pop " + (team === "A" ? "team-a" : "team-b");
  pop.textContent = "+1";
  pop.style.position = "fixed";
  const rect = card.getBoundingClientRect();
  pop.style.left = rect.left + rect.width / 2 - 20 + "px";
  pop.style.top = rect.top - 10 + "px";
  document.body.appendChild(pop);
  pop.addEventListener("animationend", () => pop.remove());
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

socket.on("disconnect", () => toast("⚠️ انقطع الاتصال..."));
socket.on("connect", () => {
  if (gameActive) {
    socket.emit("host-reconnect", { roomCode }, (res) => {
      if (res.success) {
        if (res.question) showQuestion(res.question);
        if (res.scores) updateScores(res.scores);
        updatePlayerList(res.players);
        toast("✅ تم إعادة الاتصال");
      }
    });
  }
});
