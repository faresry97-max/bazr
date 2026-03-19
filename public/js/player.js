// ─── player.js ─── Player socket logic ───

const socket = io();
const params = new URLSearchParams(window.location.search);
const roomCode = params.get("room");
const playerName = decodeURIComponent(params.get("name") || "");
const playerTeam = params.get("team") || "A";

if (!roomCode || !playerName) window.location.href = "/";

let buzzerEnabled = false;
let gameActive = false;
let iAmBuzzed = false;

const $ = (id) => document.getElementById(id);

// ─── Join Room ───
$("wait-code").textContent = roomCode;
$("wait-team").textContent = playerTeam === "A" ? "🔵 الفريق أ" : "🔴 الفريق ب";
$("wait-team").style.color = playerTeam === "A" ? "var(--tA)" : "var(--tB)";

socket.emit("join-room", { roomCode, name: playerName, team: playerTeam }, (res) => {
  if (!res.success) {
    alert(res.error || "لا يمكن الانضمام");
    window.location.href = "/";
    return;
  }
  updateScores(res.scores);
  if (res.gameState === "playing") {
    gameActive = true;
    showScreen("sc-game");
  }
});

// ─── Events ───

socket.on("player-update", (info) => {
  $("player-count").textContent = info.count;
});

socket.on("game-started", (data) => {
  gameActive = true;
  showScreen("sc-game");
  showQuestion(data.question);
  updateScores(data.scores);
  disableBuzzer("⏳ بانتظار الجرس");
  hideAnswerInput();
});

socket.on("new-question", (data) => {
  showQuestion(data);
  disableBuzzer("⏳ بانتظار الجرس");
  hideAnswerInput();
  $("p-timer-section").classList.add("hidden");
  $("p-status").textContent = "";
  $("p-answer-result").classList.add("hidden");
  iAmBuzzed = false;
});

socket.on("buzzer-open", () => {
  enableBuzzer();
  hideAnswerInput();
  $("p-status").textContent = "";
  $("p-status").style.color = "var(--lime)";
  $("p-timer-section").classList.add("hidden");
  $("p-answer-result").classList.add("hidden");
  iAmBuzzed = false;
});

socket.on("buzzer-locked", (data) => {
  const isMe = data.winnerName === playerName;
  const teamColor = data.winnerTeam === "A" ? "var(--tA)" : "var(--tB)";

  if (isMe) {
    iAmBuzzed = true;
    $("p-status").innerHTML = `<span style="color:${teamColor};font-size:18px">🎤 اكتب إجابتك!</span>`;
    disableBuzzer("🎤 أجب الآن");
    showAnswerInput();
  } else {
    iAmBuzzed = false;
    $("p-status").innerHTML = `<span style="color:${teamColor}">⚡ ${data.winnerName} يجيب...</span>`;
    disableBuzzer("🔒 مقفل");
    hideAnswerInput();
  }

  $("p-timer-section").classList.remove("hidden");
  showBuzzFlash(data.winnerTeam);
});

socket.on("timer-tick", (data) => updateTimer(data.remaining));

socket.on("timer-expired", () => {
  $("p-timer-text").textContent = "⏰";
  $("p-timer-text").classList.add("danger");
  hideAnswerInput();
  iAmBuzzed = false;
});

socket.on("answer-result", (data) => {
  $("p-timer-section").classList.add("hidden");
  hideAnswerInput();
  iAmBuzzed = false;

  const icon = data.correct ? "✅" : "❌";
  const color = data.correct ? "var(--lime)" : "var(--red)";
  const label = data.correct ? "صحيح!" : "خطأ";

  $("p-status").innerHTML = `<span style="color:${color};font-size:18px">${icon} ${data.playerName} — ${label}</span>`;

  // Show correct answer
  const ar = $("p-answer-result");
  ar.classList.remove("hidden");
  ar.innerHTML = `<div style="color:var(--gold);font-weight:700">الإجابة: ${data.correctAnswer || ""}</div>`;

  disableBuzzer("⏳ السؤال التالي");
});

socket.on("question-skipped", (data) => {
  $("p-timer-section").classList.add("hidden");
  hideAnswerInput();
  iAmBuzzed = false;
  $("p-status").innerHTML = '<span style="color:var(--mid)">⏭️ تم تخطّي السؤال</span>';
  if (data.correctAnswer) {
    const ar = $("p-answer-result");
    ar.classList.remove("hidden");
    ar.innerHTML = `<div style="color:var(--gold);font-weight:700">الإجابة: ${data.correctAnswer}</div>`;
  }
  disableBuzzer("⏳ السؤال التالي");
});

socket.on("score-update", (scores) => updateScores(scores));

socket.on("game-over", (data) => {
  sessionStorage.setItem("bazr-results", JSON.stringify(data));
  window.location.href = "/results.html";
});

socket.on("host-disconnected", () => {
  $("p-status").innerHTML = '<span style="color:var(--red)">⚠️ المقدّم انقطع — بانتظار العودة</span>';
});

socket.on("kicked", () => {
  alert("تم طردك من الغرفة");
  window.location.href = "/";
});

// ─── Actions ───

function buzz() {
  if (!buzzerEnabled) return;
  socket.emit("buzz", { roomCode });
  disableBuzzer("⏳ ...");
}

function submitAnswer() {
  const input = $("answer-input");
  const answer = input.value.trim();
  if (!answer) return;
  socket.emit("submit-answer", { roomCode, answer });
  input.value = "";
  $("answer-submit-btn").disabled = true;
  hideAnswerInput();
  $("p-status").innerHTML = '<span style="color:var(--mid)">⏳ جاري التحقق...</span>';
}

// ─── UI Helpers ───

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

function showQuestion(q) {
  if (!q) return;
  $("p-question").textContent = q.text || "—";
}

function enableBuzzer() {
  buzzerEnabled = true;
  const btn = $("buzz-btn");
  btn.disabled = false;
  btn.classList.add("open");
  btn.textContent = "بازر!";
  $("buzzer-wrap").classList.remove("hidden");
}

function disableBuzzer(label) {
  buzzerEnabled = false;
  const btn = $("buzz-btn");
  btn.disabled = true;
  btn.classList.remove("open");
  btn.textContent = label || "بازر!";
}

function showAnswerInput() {
  $("answer-wrap").classList.remove("hidden");
  $("buzzer-wrap").classList.add("hidden");
  $("answer-submit-btn").disabled = false;
  const input = $("answer-input");
  input.value = "";
  setTimeout(() => input.focus(), 100);
}

function hideAnswerInput() {
  $("answer-wrap").classList.add("hidden");
  $("buzzer-wrap").classList.remove("hidden");
}

function updateScores(scores) {
  if (!scores) return;
  $("p-score-a").textContent = scores.A;
  $("p-score-b").textContent = scores.B;
}

function updateTimer(remaining) {
  const pct = (remaining / 15) * 100;
  const bar = $("p-timer-bar");
  const text = $("p-timer-text");
  bar.style.width = pct + "%";
  text.textContent = remaining;
  bar.classList.remove("warn", "danger");
  text.classList.remove("danger");
  if (remaining <= 3) { bar.classList.add("danger"); text.classList.add("danger"); }
  else if (remaining <= 7) { bar.classList.add("warn"); }
}

function showBuzzFlash(team) {
  const el = document.createElement("div");
  el.className = "buzz-flash " + (team === "A" ? "team-a" : "team-b");
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── Reconnection ───
socket.on("disconnect", () => { $("dc-overlay").classList.remove("hidden"); });
socket.on("connect", () => {
  $("dc-overlay").classList.add("hidden");
  if (gameActive) {
    socket.emit("join-room", { roomCode, name: playerName, team: playerTeam }, (res) => {
      if (res.success) { updateScores(res.scores); toast("✅ تم إعادة الاتصال"); }
    });
  }
});

// ─── Keyboard shortcuts ───
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && buzzerEnabled) { e.preventDefault(); buzz(); }
  if (e.key === "Enter" && iAmBuzzed && !$("answer-wrap").classList.contains("hidden")) {
    e.preventDefault();
    submitAnswer();
  }
});
