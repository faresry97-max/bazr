// ─── player.js — Enhanced buzzer + smooth UX ───
const socket = io();
const params = new URLSearchParams(window.location.search);
const roomCode = params.get("room");
const playerName = decodeURIComponent(params.get("name") || "");
const playerTeam = params.get("team") || "A";
if (!roomCode || !playerName) window.location.href = "/";

let buzzerEnabled = false, gameActive = false, iAmBuzzed = false, chatOpen = false, unreadChat = 0;
const $ = id => document.getElementById(id);

// ── Audio Engine ──
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx;
function ensureAudio() { if (!actx) actx = new AudioCtx(); }

function playBuzzSound() {
  ensureAudio();
  // Deep satisfying buzz tone
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  o.type = "square"; o.frequency.setValueAtTime(180, actx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, actx.currentTime + 0.15);
  g.gain.setValueAtTime(0.25, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.2);
  o.start(); o.stop(actx.currentTime + 0.2);
  // High click
  const o2 = actx.createOscillator(), g2 = actx.createGain();
  o2.connect(g2); g2.connect(actx.destination);
  o2.type = "sine"; o2.frequency.value = 1200;
  g2.gain.setValueAtTime(0.15, actx.currentTime);
  g2.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.08);
  o2.start(); o2.stop(actx.currentTime + 0.08);
}

function playCorrectSound() {
  ensureAudio();
  [523, 659, 784].forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.15, actx.currentTime + i * 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + i * 0.1 + 0.2);
    o.start(actx.currentTime + i * 0.1); o.stop(actx.currentTime + i * 0.1 + 0.2);
  });
}

function playWrongSound() {
  ensureAudio();
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  o.type = "sawtooth"; o.frequency.setValueAtTime(200, actx.currentTime);
  o.frequency.setValueAtTime(140, actx.currentTime + 0.15);
  g.gain.setValueAtTime(0.12, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.3);
  o.start(); o.stop(actx.currentTime + 0.3);
}

function playReadySound() {
  ensureAudio();
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  o.type = "sine"; o.frequency.value = 660;
  g.gain.setValueAtTime(0.1, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.15);
  o.start(); o.stop(actx.currentTime + 0.15);
}

// ── Ripple effect on buzz ──
function spawnRipple() {
  const container = $("buzz-ripple");
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const wave = document.createElement("div");
      wave.className = "ripple-wave";
      container.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove());
    }, i * 120);
  }
}

// ── Haptic feedback ──
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ── Init ──
socket.on("global-stats", d => { $("global-online").textContent = "🌐 " + d.online; });

$("wait-code").textContent = roomCode;
$("wait-team").textContent = playerTeam === "A" ? "🔵 الفريق أ" : "🔴 الفريق ب";
$("wait-team").style.color = playerTeam === "A" ? "var(--tA)" : "var(--tB)";

socket.emit("join-room", { roomCode, name: playerName, team: playerTeam }, res => {
  if (!res.success) { alert(res.error || "لا يمكن الانضمام"); window.location.href = "/"; return; }
  updateScores(res.scores);
  if (res.gameState === "playing") { gameActive = true; showScreen("sc-game"); }
});

// ── Socket Events ──
socket.on("player-update", d => { $("player-count").textContent = d.count; });

socket.on("game-started", d => {
  gameActive = true; showScreen("sc-game"); showQuestion(d.question); updateScores(d.scores);
  disableBuzzer("⏳ بانتظار الجرس"); hideAnswerInput();
});

socket.on("new-question", d => {
  showQuestion(d); disableBuzzer("⏳ بانتظار الجرس"); hideAnswerInput();
  $("p-timer-section").classList.add("hidden"); $("p-status").textContent = "";
  $("p-answer-result").classList.add("hidden"); iAmBuzzed = false;
});

socket.on("buzzer-open", () => {
  enableBuzzer(); hideAnswerInput(); playReadySound(); vibrate(50);
  $("p-status").innerHTML = '<span style="color:var(--lime);font-size:15px">🟢 الجرس مفتوح — اضغط بسرعة!</span>';
  $("p-timer-section").classList.add("hidden");
  $("p-answer-result").classList.add("hidden"); iAmBuzzed = false;
});

socket.on("buzzer-locked", d => {
  const isMe = d.winnerName === playerName;
  const clr = d.winnerTeam === "A" ? "var(--tA)" : "var(--tB)";
  if (isMe) {
    iAmBuzzed = true;
    $("p-status").innerHTML = `<span style="color:${clr};font-size:17px">🎤 أنت المجيب — اكتب إجابتك!</span>`;
    disableBuzzer("🎤 أجب"); showAnswerInput(); vibrate([100, 50, 100]);
  } else {
    iAmBuzzed = false;
    $("p-status").innerHTML = `<span style="color:${clr}">⚡ ${d.winnerName} يجيب...</span>`;
    disableBuzzer("🔒 مقفل"); hideAnswerInput();
  }
  $("p-timer-section").classList.remove("hidden"); showBuzzFlash(d.winnerTeam);
});

socket.on("timer-tick", d => updateTimer(d.remaining));
socket.on("timer-expired", () => { $("p-timer-text").textContent = "⏰"; $("p-timer-text").classList.add("danger"); hideAnswerInput(); iAmBuzzed = false; });

socket.on("answer-result", d => {
  $("p-timer-section").classList.add("hidden"); hideAnswerInput(); iAmBuzzed = false;
  const icon = d.correct ? "✅" : "❌", color = d.correct ? "var(--lime)" : "var(--red)";
  $("p-status").innerHTML = `<span style="color:${color};font-size:17px">${icon} ${d.playerName} — ${d.correct ? "صحيح!" : "خطأ"}</span>`;
  const ar = $("p-answer-result"); ar.classList.remove("hidden");
  ar.innerHTML = `<div style="color:var(--gold);font-weight:700;font-size:15px">الإجابة: ${d.correctAnswer || ""}</div>`;
  disableBuzzer("⏳ السؤال التالي");
  if (d.correct && d.playerName === playerName) { playCorrectSound(); vibrate(200); }
  else if (!d.correct && d.playerName === playerName) { playWrongSound(); vibrate([100, 50, 100, 50, 100]); }
});

socket.on("question-skipped", d => {
  $("p-timer-section").classList.add("hidden"); hideAnswerInput(); iAmBuzzed = false;
  $("p-status").innerHTML = '<span style="color:var(--mid)">⏭️ تخطّي</span>';
  if (d.correctAnswer) { const ar = $("p-answer-result"); ar.classList.remove("hidden"); ar.innerHTML = `<div style="color:var(--gold);font-weight:700">الإجابة: ${d.correctAnswer}</div>`; }
  disableBuzzer("⏳");
});

socket.on("score-update", s => updateScores(s));
socket.on("game-over", d => { sessionStorage.setItem("bazr-results", JSON.stringify(d)); window.location.href = "/results.html"; });
socket.on("host-disconnected", () => { $("p-status").innerHTML = '<span style="color:var(--red)">⚠️ المقدّم انقطع</span>'; });
socket.on("kicked", () => { alert("تم طردك"); window.location.href = "/"; });

// ── Chat ──
socket.on("chat-msg", d => {
  const el = $("p-chat"), cls = d.team === "A" ? "a" : d.team === "B" ? "b" : "host";
  if (d.type === "reaction") el.innerHTML += `<div class="chat-msg reaction">${d.msg}</div>`;
  else el.innerHTML += `<div class="chat-msg"><span class="cm-name ${cls}">${d.name}:</span> ${d.msg}</div>`;
  el.scrollTop = el.scrollHeight;
  if (!chatOpen) { unreadChat++; const b = $("chat-badge"); b.textContent = unreadChat; b.classList.remove("hidden"); }
});
function toggleChat() { chatOpen = !chatOpen; $("chat-panel").classList.toggle("expanded", chatOpen); if (chatOpen) { unreadChat = 0; $("chat-badge").classList.add("hidden"); } }
function sendChat() { const input = $("p-chat-input"), msg = input.value.trim(); if (!msg) return; socket.emit("chat-msg", { roomCode, msg }); input.value = ""; }
function sendReaction(emoji) { socket.emit("reaction", { roomCode, emoji }); }

// ── Actions ──
function buzz() {
  if (!buzzerEnabled) return;
  playBuzzSound(); spawnRipple(); vibrate(80);
  socket.emit("buzz", { roomCode });
  disableBuzzer("⏳ ...");
}

function submitAnswer() {
  const input = $("answer-input"), a = input.value.trim();
  if (!a) return;
  socket.emit("submit-answer", { roomCode, answer: a });
  input.value = ""; $("answer-submit-btn").disabled = true; hideAnswerInput();
  $("p-status").innerHTML = '<span style="color:var(--mid)">⏳ جاري التحقق...</span>';
}

// ── UI ──
function showScreen(id) { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); $(id).classList.add("active"); }
function showQuestion(q) {
  if (!q) return; $("p-question").textContent = q.text || "—";
  if (q.img) { $("p-img").src = q.img; $("p-img-wrap").classList.remove("hidden"); } else { $("p-img-wrap").classList.add("hidden"); }
}

function enableBuzzer() {
  buzzerEnabled = true;
  const btn = $("buzz-btn"); btn.disabled = false; btn.classList.add("ready");
  btn.innerHTML = '🔔<span class="bz-label">اضغط!</span>';
  $("buzzer-wrap").classList.remove("hidden");
  $("buzz-ring").classList.add("ready"); $("buzz-ring").classList.remove("locked");
}

function disableBuzzer(label) {
  buzzerEnabled = false;
  const btn = $("buzz-btn"); btn.disabled = true; btn.classList.remove("ready");
  btn.innerHTML = label || "🔔";
  $("buzz-ring").classList.remove("ready"); $("buzz-ring").classList.add("locked");
}

function showAnswerInput() {
  $("answer-wrap").classList.remove("hidden"); $("buzzer-wrap").classList.add("hidden");
  $("answer-submit-btn").disabled = false; const i = $("answer-input"); i.value = ""; setTimeout(() => i.focus(), 100);
}
function hideAnswerInput() { $("answer-wrap").classList.add("hidden"); $("buzzer-wrap").classList.remove("hidden"); }
function updateScores(s) { if (!s) return; $("p-score-a").textContent = s.A; $("p-score-b").textContent = s.B; }

function updateTimer(r) {
  const p = (r / 15) * 100;
  $("p-timer-bar").style.width = p + "%"; $("p-timer-text").textContent = r;
  $("p-timer-bar").classList.remove("warn", "danger"); $("p-timer-text").classList.remove("danger");
  if (r <= 3) { $("p-timer-bar").classList.add("danger"); $("p-timer-text").classList.add("danger"); }
  else if (r <= 7) $("p-timer-bar").classList.add("warn");
}

function showBuzzFlash(t) {
  const el = document.createElement("div");
  el.className = "buzz-flash " + (t === "A" ? "team-a" : "team-b");
  document.body.appendChild(el); el.addEventListener("animationend", () => el.remove());
}

function toast(m) { const el = document.createElement("div"); el.className = "toast"; el.textContent = m; document.body.appendChild(el); setTimeout(() => el.remove(), 3200); }

// ── Connection ──
socket.on("disconnect", () => { $("dc-overlay").classList.remove("hidden"); });
socket.on("connect", () => {
  $("dc-overlay").classList.add("hidden");
  if (gameActive) socket.emit("join-room", { roomCode, name: playerName, team: playerTeam }, res => {
    if (res.success) { updateScores(res.scores); toast("✅ تم إعادة الاتصال"); }
  });
});

// ── Keyboard ──
document.addEventListener("keydown", e => {
  if (e.code === "Space" && buzzerEnabled) { e.preventDefault(); buzz(); }
  if (e.key === "Enter" && iAmBuzzed && !$("answer-wrap").classList.contains("hidden")) { e.preventDefault(); submitAnswer(); }
});
