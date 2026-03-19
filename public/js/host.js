// ─── host.js ───
const socket = io();
const params = new URLSearchParams(window.location.search);
const roomCode = params.get("room");
if (!roomCode) window.location.href = "/";

let gameActive = false, currentQuestion = null, buzzedPlayer = null;
const $ = id => document.getElementById(id);

socket.on("global-stats", d => { $("global-online").textContent = "🌐 " + d.online + " أونلاين"; });

socket.emit("host-reconnect", { roomCode }, res => {
  if (!res.success) { alert("الغرفة غير موجودة"); window.location.href = "/"; return; }
  $("lobby-code").textContent = roomCode;
  if (res.state === "playing") { gameActive = true; showScreen("sc-game"); if (res.question) showQuestion(res.question); if (res.scores) updateScores(res.scores); if (res.buzzedPlayer) handleBuzzIn(res.buzzedPlayer); }
  updatePlayerList(res.players);
});

// ── Events ──
socket.on("player-update", info => { $("player-count").textContent = info.count; updatePlayerList(info); });
socket.on("game-started", d => { gameActive = true; showScreen("sc-game"); showQuestion(d.question); updateScores(d.scores); resetBuzzState(); });
socket.on("buzzer-open", () => { $("buzz-status").className = "buzz-status open"; $("buzz-status").innerHTML = '<div style="color:var(--lime);font-size:18px;font-weight:900">🟢 الجرس مفتوح!</div>'; $("open-buzz-btn").disabled = true; $("answer-result").classList.add("hidden"); $("judge-override").classList.add("hidden"); buzzedPlayer = null; });
socket.on("buzzer-locked", d => handleBuzzIn(d));
socket.on("timer-tick", d => updateTimer(d.remaining));
socket.on("timer-expired", () => { $("timer-text").textContent = "⏰"; $("timer-text").classList.add("danger"); });
socket.on("answer-result", d => {
  $("timer-section").classList.add("hidden");
  const icon = d.correct ? "✅" : "❌", color = d.correct ? "var(--lime)" : "var(--red)";
  $("buzz-status").innerHTML = `<div style="color:${color};font-size:18px;font-weight:900">${icon} ${d.correct ? "صحيح!" : "خطأ"}</div><div style="font-size:13px;color:var(--mid)">${d.playerName}</div>`;
  const ar = $("answer-result"); ar.classList.remove("hidden");
  ar.innerHTML = `<div class="ar-row"><span class="ar-label">الإجابة:</span><span style="color:${color};font-weight:700">${d.submittedAnswer || "انتهى الوقت"}</span></div><div class="ar-row"><span class="ar-label">الصحيحة:</span><span style="color:var(--gold);font-weight:700">${d.correctAnswer || currentQuestion?.answer || ""}</span></div>${d.similarity !== undefined ? `<div class="ar-row"><span class="ar-label">التطابق:</span><span>${d.similarity}%</span></div>` : ""}`;
  if (!d.override) $("judge-override").classList.remove("hidden");
  if (currentQuestion?.answer) { $("q-answer").textContent = "الإجابة: " + currentQuestion.answer; $("q-answer").classList.add("visible"); }
  if (d.correct) spawnScorePop(d.team);
  $("open-buzz-btn").disabled = false; buzzedPlayer = null;
});
socket.on("question-skipped", d => { if (d.correctAnswer) { $("q-answer").textContent = "الإجابة: " + d.correctAnswer; $("q-answer").classList.add("visible"); } $("buzz-status").innerHTML = '<div style="color:var(--mid)">⏭️ تم التخطّي</div>'; $("timer-section").classList.add("hidden"); $("open-buzz-btn").disabled = false; buzzedPlayer = null; });
socket.on("new-question", d => { showQuestion(d); resetBuzzState(); });
socket.on("score-update", s => updateScores(s));
socket.on("game-over", d => { sessionStorage.setItem("bazr-results", JSON.stringify(d)); window.location.href = "/results.html"; });
socket.on("chat-msg", d => appendChat(d));

// ── Actions ──
function startGame() { socket.emit("start-game", { roomCode }); }
function openBuzzer() { socket.emit("open-buzzer", { roomCode }); }
function nextQuestion() { socket.emit("next-question", { roomCode }); }
function skipQuestion() { socket.emit("skip-question", { roomCode }); }
function judgeOverride(c) { socket.emit("judge-override", { roomCode, correct: c }); $("judge-override").classList.add("hidden"); }
function kickPlayer(id) { if (confirm("طرد اللاعب؟")) socket.emit("kick-player", { roomCode, playerId: id }); }
function sendChat() { const input = $("h-chat-input"); const msg = input.value.trim(); if (!msg) return; socket.emit("chat-msg", { roomCode, msg }); input.value = ""; }
function sendReaction(emoji) { socket.emit("reaction", { roomCode, emoji }); }

// ── UI ──
function showScreen(id) { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); $(id).classList.add("active"); }
function showQuestion(q) { currentQuestion = q; $("q-cat").textContent = q.cat || ""; $("q-progress").textContent = `${q.index+1} / ${q.total}`; $("q-text").textContent = q.text; $("q-answer").textContent = ""; $("q-answer").classList.remove("visible"); $("open-buzz-btn").disabled = false;
  if (q.img) { loadImg($("q-img"), q.img); $("q-img-wrap").classList.remove("hidden"); } else { $("q-img-wrap").classList.add("hidden"); }
}
function resetBuzzState() { buzzedPlayer = null; $("buzz-status").className = "buzz-status"; $("buzz-status").innerHTML = '<div class="text-dim">⏳ بانتظار فتح الجرس...</div>'; $("timer-section").classList.add("hidden"); $("timer-text").classList.remove("danger"); $("answer-result").classList.add("hidden"); $("judge-override").classList.add("hidden"); }
function handleBuzzIn(d) { buzzedPlayer = d; const tc = d.winnerTeam === "A" ? "locked-a" : "locked-b", clr = d.winnerTeam === "A" ? "var(--tA)" : "var(--tB)"; $("buzz-status").className = "buzz-status " + tc; $("buzz-status").innerHTML = `<div class="buzz-name" style="color:${clr}">🎤 ${d.winnerName}</div><div class="buzz-team-label" style="color:${clr}">يكتب إجابته...</div>`; $("timer-section").classList.remove("hidden"); $("open-buzz-btn").disabled = true; $("answer-result").classList.add("hidden"); $("judge-override").classList.add("hidden"); showBuzzFlash(d.winnerTeam); }
function updateTimer(r) { const p = (r/15)*100; $("timer-bar").style.width = p+"%"; $("timer-text").textContent = r; $("timer-bar").classList.remove("warn","danger"); $("timer-text").classList.remove("danger"); if (r<=3) { $("timer-bar").classList.add("danger"); $("timer-text").classList.add("danger"); } else if (r<=7) $("timer-bar").classList.add("warn"); }
function updateScores(s) { $("score-a").textContent = s.A; $("score-b").textContent = s.B; }

function updatePlayerList(info) {
  const players = info.players || [], count = info.count || players.filter(p=>p.connected).length;
  $("player-count").textContent = count;
  const teamA = players.filter(p=>p.team==="A"), teamB = players.filter(p=>p.team==="B");
  const render = list => list.length ? list.map(p => `<div class="lobby-player ${p.connected?"":"offline"}"><span class="lobby-dot ${p.connected?"on":"off"}"></span><span>${p.name}</span>${!gameActive?`<button class="kick-btn" onclick="kickPlayer('${p.id}')">✕</button>`:""}</div>`).join("") : '<div class="text-dim" style="font-size:13px">بانتظار...</div>';
  if ($("lobby-team-a")) $("lobby-team-a").innerHTML = render(teamA);
  if ($("lobby-team-b")) $("lobby-team-b").innerHTML = render(teamB);
  if ($("start-btn")) { const c = players.filter(p=>p.connected).length; $("start-btn").disabled = c<1; if (c>0) $("lobby-hint").textContent = c + " لاعب جاهز"; }
  if ($("game-players")) $("game-players").innerHTML = players.map(p => `<li class="player-row"><span class="player-dot ${p.connected?"online":"offline"}"></span><span class="player-name">${p.name}</span><span class="player-team-badge ${p.team==="A"?"a":"b"}">${p.team==="A"?"أ":"ب"}</span><span style="font-weight:700;color:var(--gold)">${p.score||0}</span><button class="kick-btn" onclick="kickPlayer('${p.id}')">✕</button></li>`).join("");
}

function appendChat(d) {
  const el = $("h-chat"); const cls = d.team === "A" ? "a" : d.team === "B" ? "b" : "host";
  if (d.type === "reaction") { el.innerHTML += `<div class="chat-msg reaction">${d.msg}</div>`; }
  else { el.innerHTML += `<div class="chat-msg"><span class="cm-name ${cls}">${d.name}:</span> ${d.msg}</div>`; }
  el.scrollTop = el.scrollHeight;
}

function showBuzzFlash(t) { const el = document.createElement("div"); el.className = "buzz-flash " + (t==="A"?"team-a":"team-b"); document.body.appendChild(el); el.addEventListener("animationend", () => el.remove()); }
function spawnScorePop(t) { const c = t==="A"?$("score-a"):$("score-b"); const p = document.createElement("div"); p.className = "score-pop "+(t==="A"?"team-a":"team-b"); p.textContent = "+1"; p.style.position = "fixed"; const r = c.getBoundingClientRect(); p.style.left = r.left+r.width/2-18+"px"; p.style.top = r.top-8+"px"; document.body.appendChild(p); p.addEventListener("animationend", () => p.remove()); }
function toast(m) { const el = document.createElement("div"); el.className = "toast"; el.textContent = m; document.body.appendChild(el); setTimeout(()=>el.remove(),3200); }

// ── Robust image loader with retry ──
function loadImg(el, src, retries=2) {
  el.classList.add("loading"); el.classList.remove("failed");
  el.onload = () => { el.classList.remove("loading"); };
  el.onerror = () => {
    if (retries > 0) { setTimeout(() => { el.src = ""; loadImg(el, src, retries - 1); }, 1000); }
    else { el.classList.add("failed"); el.classList.remove("loading"); }
  };
  el.src = src;
}

socket.on("disconnect", () => toast("⚠️ انقطع الاتصال..."));
socket.on("connect", () => { if (gameActive) socket.emit("host-reconnect", { roomCode }, res => { if (res.success) { if (res.question) showQuestion(res.question); if (res.scores) updateScores(res.scores); updatePlayerList(res.players); toast("✅ تم إعادة الاتصال"); } }); });
