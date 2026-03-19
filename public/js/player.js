// ─── player.js ───
const socket = io();
const params = new URLSearchParams(window.location.search);
const roomCode = params.get("room");
const playerName = decodeURIComponent(params.get("name") || "");
const playerTeam = params.get("team") || "A";
if (!roomCode || !playerName) window.location.href = "/";

let buzzerEnabled = false, gameActive = false, iAmBuzzed = false, chatOpen = false, unreadChat = 0;
const $ = id => document.getElementById(id);

socket.on("global-stats", d => { $("global-online").textContent = "🌐 " + d.online; });

$("wait-code").textContent = roomCode;
$("wait-team").textContent = playerTeam === "A" ? "🔵 الفريق أ" : "🔴 الفريق ب";
$("wait-team").style.color = playerTeam === "A" ? "var(--tA)" : "var(--tB)";

socket.emit("join-room", { roomCode, name: playerName, team: playerTeam }, res => {
  if (!res.success) { alert(res.error || "لا يمكن الانضمام"); window.location.href = "/"; return; }
  updateScores(res.scores);
  if (res.gameState === "playing") { gameActive = true; showScreen("sc-game"); }
});

// ── Events ──
socket.on("player-update", d => { $("player-count").textContent = d.count; });
socket.on("game-started", d => { gameActive = true; showScreen("sc-game"); showQuestion(d.question); updateScores(d.scores); disableBuzzer("⏳"); hideAnswerInput(); });
socket.on("new-question", d => { showQuestion(d); disableBuzzer("⏳"); hideAnswerInput(); $("p-timer-section").classList.add("hidden"); $("p-status").textContent = ""; $("p-answer-result").classList.add("hidden"); iAmBuzzed = false; });
socket.on("buzzer-open", () => { enableBuzzer(); hideAnswerInput(); $("p-status").textContent = ""; $("p-timer-section").classList.add("hidden"); $("p-answer-result").classList.add("hidden"); iAmBuzzed = false; });

socket.on("buzzer-locked", d => {
  const isMe = d.winnerName === playerName, clr = d.winnerTeam === "A" ? "var(--tA)" : "var(--tB)";
  if (isMe) { iAmBuzzed = true; $("p-status").innerHTML = `<span style="color:${clr};font-size:17px">🎤 اكتب إجابتك!</span>`; disableBuzzer("🎤"); showAnswerInput(); }
  else { iAmBuzzed = false; $("p-status").innerHTML = `<span style="color:${clr}">⚡ ${d.winnerName} يجيب...</span>`; disableBuzzer("🔒"); hideAnswerInput(); }
  $("p-timer-section").classList.remove("hidden"); showBuzzFlash(d.winnerTeam);
});

socket.on("timer-tick", d => updateTimer(d.remaining));
socket.on("timer-expired", () => { $("p-timer-text").textContent = "⏰"; $("p-timer-text").classList.add("danger"); hideAnswerInput(); iAmBuzzed = false; });

socket.on("answer-result", d => {
  $("p-timer-section").classList.add("hidden"); hideAnswerInput(); iAmBuzzed = false;
  const icon = d.correct ? "✅" : "❌", color = d.correct ? "var(--lime)" : "var(--red)";
  $("p-status").innerHTML = `<span style="color:${color};font-size:17px">${icon} ${d.playerName} — ${d.correct ? "صحيح!" : "خطأ"}</span>`;
  const ar = $("p-answer-result"); ar.classList.remove("hidden");
  ar.innerHTML = `<div style="color:var(--gold);font-weight:700">الإجابة: ${d.correctAnswer || ""}</div>`;
  disableBuzzer("⏳");
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
  const el = $("p-chat"); const cls = d.team === "A" ? "a" : d.team === "B" ? "b" : "host";
  if (d.type === "reaction") el.innerHTML += `<div class="chat-msg reaction">${d.msg}</div>`;
  else el.innerHTML += `<div class="chat-msg"><span class="cm-name ${cls}">${d.name}:</span> ${d.msg}</div>`;
  el.scrollTop = el.scrollHeight;
  if (!chatOpen) { unreadChat++; const b = $("chat-badge"); b.textContent = unreadChat; b.classList.remove("hidden"); }
});

function toggleChat() { chatOpen = !chatOpen; $("chat-panel").classList.toggle("expanded", chatOpen); if (chatOpen) { unreadChat = 0; $("chat-badge").classList.add("hidden"); } }
function sendChat() { const input = $("p-chat-input"); const msg = input.value.trim(); if (!msg) return; socket.emit("chat-msg", { roomCode, msg }); input.value = ""; }
function sendReaction(emoji) { socket.emit("reaction", { roomCode, emoji }); }

// ── Actions ──
function buzz() { if (!buzzerEnabled) return; socket.emit("buzz", { roomCode }); disableBuzzer("⏳"); }
function submitAnswer() { const input = $("answer-input"); const a = input.value.trim(); if (!a) return; socket.emit("submit-answer", { roomCode, answer: a }); input.value = ""; $("answer-submit-btn").disabled = true; hideAnswerInput(); $("p-status").innerHTML = '<span style="color:var(--mid)">⏳ جاري التحقق...</span>'; }

// ── UI ──
function showScreen(id) { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); $(id).classList.add("active"); }
function showQuestion(q) { if (!q) return; $("p-question").textContent = q.text || "—"; }
function enableBuzzer() { buzzerEnabled = true; const b = $("buzz-btn"); b.disabled = false; b.classList.add("open"); b.textContent = "بازر!"; $("buzzer-wrap").classList.remove("hidden"); }
function disableBuzzer(l) { buzzerEnabled = false; const b = $("buzz-btn"); b.disabled = true; b.classList.remove("open"); b.textContent = l || "بازر!"; }
function showAnswerInput() { $("answer-wrap").classList.remove("hidden"); $("buzzer-wrap").classList.add("hidden"); $("answer-submit-btn").disabled = false; const i = $("answer-input"); i.value = ""; setTimeout(() => i.focus(), 100); }
function hideAnswerInput() { $("answer-wrap").classList.add("hidden"); $("buzzer-wrap").classList.remove("hidden"); }
function updateScores(s) { if (!s) return; $("p-score-a").textContent = s.A; $("p-score-b").textContent = s.B; }
function updateTimer(r) { const p = (r/15)*100; $("p-timer-bar").style.width = p+"%"; $("p-timer-text").textContent = r; $("p-timer-bar").classList.remove("warn","danger"); $("p-timer-text").classList.remove("danger"); if (r<=3){$("p-timer-bar").classList.add("danger");$("p-timer-text").classList.add("danger")}else if(r<=7)$("p-timer-bar").classList.add("warn"); }
function showBuzzFlash(t) { const el = document.createElement("div"); el.className = "buzz-flash "+(t==="A"?"team-a":"team-b"); document.body.appendChild(el); el.addEventListener("animationend", () => el.remove()); }
function toast(m) { const el = document.createElement("div"); el.className = "toast"; el.textContent = m; document.body.appendChild(el); setTimeout(()=>el.remove(),3200); }

socket.on("disconnect", () => { $("dc-overlay").classList.remove("hidden"); });
socket.on("connect", () => { $("dc-overlay").classList.add("hidden"); if (gameActive) socket.emit("join-room", { roomCode, name: playerName, team: playerTeam }, res => { if (res.success) { updateScores(res.scores); toast("✅ تم إعادة الاتصال"); } }); });

document.addEventListener("keydown", e => {
  if (e.code === "Space" && buzzerEnabled) { e.preventDefault(); buzz(); }
  if (e.key === "Enter" && iAmBuzzed && !$("answer-wrap").classList.contains("hidden")) { e.preventDefault(); submitAnswer(); }
});
