// ─── results.js ─── Final scores display and confetti ───

const $ = (id) => document.getElementById(id);

// ─── Load results from sessionStorage ───
const raw = sessionStorage.getItem("bazr-results");
if (!raw) {
  window.location.href = "/";
}

const data = JSON.parse(raw);
const scores = data.scores;
const winner = data.winner; // "A", "B", or "tie"

// ─── Populate scores ───
$("r-score-a").textContent = scores.A;
$("r-score-b").textContent = scores.B;

// ─── Winner styling ───
if (winner === "A") {
  $("r-title").textContent = "فاز الفريق أ!";
  $("r-title").classList.add("team-a");
  $("r-card-a").classList.add("winner");
  $("r-subtitle").textContent = `${scores.A} — ${scores.B}`;
} else if (winner === "B") {
  $("r-title").textContent = "فاز الفريق ب!";
  $("r-title").classList.add("team-b");
  $("r-card-b").classList.add("winner");
  $("r-subtitle").textContent = `${scores.A} — ${scores.B}`;
} else {
  $("r-crown").textContent = "🤝";
  $("r-title").textContent = "تعادل!";
  $("r-title").classList.add("tie");
  $("r-subtitle").textContent = `${scores.A} — ${scores.B}`;
}

// ─── Player leaderboard ───
if (scores.players && scores.players.length > 0) {
  const sorted = [...scores.players].sort((a, b) => b.score - a.score);
  $("r-player-list").innerHTML = sorted
    .map((p, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      const teamColor = p.team === "A" ? "var(--tA)" : "var(--tB)";
      return `<div class="pr-row">
        <span class="pr-rank">${medal}</span>
        <span class="pr-name">${p.name}</span>
        <span class="player-team-badge ${p.team === "A" ? "a" : "b"}">${p.team === "A" ? "أ" : "ب"}</span>
        <span class="pr-score" style="color:${teamColor}">${p.score}</span>
      </div>`;
    })
    .join("");
} else {
  $("r-players").classList.add("hidden");
}

// ─── Confetti Animation ───
const canvas = $("confetti-canvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const confettiColors = ["#f0b429", "#ffe066", "#38c7f0", "#f05060", "#22d58e", "#a78bfa"];
const particles = [];

function createParticle() {
  return {
    x: Math.random() * canvas.width,
    y: -10,
    w: Math.random() * 8 + 4,
    h: Math.random() * 6 + 3,
    color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: Math.random() * 3 + 2,
    rot: Math.random() * 360,
    rotV: (Math.random() - 0.5) * 10,
    opacity: 1,
  };
}

// Burst of confetti
for (let i = 0; i < 120; i++) {
  const p = createParticle();
  p.y = Math.random() * canvas.height * 0.3;
  particles.push(p);
}

function animateConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.rotV;
    p.vy += 0.05; // gravity
    p.opacity -= 0.003;

    if (p.opacity <= 0 || p.y > canvas.height + 20) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }

  if (particles.length > 0) {
    requestAnimationFrame(animateConfetti);
  }
}

animateConfetti();

// Handle resize
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
