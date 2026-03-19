// ─── htmlParser.js ─── Parse questions from s&g.html ───
// Extracts the AQ array from the HTML file and converts to game format

const fs = require("fs");
const path = require("path");

// Category name mapping (strip emojis for cleaner integration)
const CAT_MAP = {
  "جغرافيا 🌍": "جغرافيا",
  "علوم 🔬": "علوم",
  "تاريخ 📜": "تاريخ",
  "رياضة ⚽": "رياضة",
  "ثقافة 📚": "ثقافة",
  "إسلامية 🕌": "إسلام",
  "تكنولوجيا 💻": "تكنولوجيا",
};

/**
 * Parse the s&g.html file and extract all questions
 * @param {string} filePath - Path to the HTML file
 * @returns {Array} Array of question objects in game format {id, cat, diff, q, a, opts}
 */
function parseHTML(filePath) {
  let html;
  try {
    html = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`[htmlParser] Cannot read file: ${filePath}`, err.message);
    return [];
  }

  const questions = [];
  let idCounter = 20001; // Start IDs at 20001 to avoid conflicts

  // ── Strategy 1: Extract the AQ array using regex ──
  // Look for: const AQ=[...]; or AQ=[...];
  const aqMatch = html.match(/(?:const\s+)?AQ\s*=\s*\[([\s\S]*?)\];/);
  if (aqMatch) {
    const rawArray = aqMatch[1];
    // Parse each {cat:...,q:...,o:[...],c:N} object
    const objRegex = /\{[^}]*cat\s*:\s*"([^"]*)"[^}]*q\s*:\s*"([^"]*)"[^}]*o\s*:\s*\[([^\]]*)\][^}]*c\s*:\s*(\d+)[^}]*\}/g;
    let match;

    while ((match = objRegex.exec(rawArray)) !== null) {
      try {
        const rawCat = match[1].trim();
        const questionText = match[2].trim();
        const optionsRaw = match[3];
        const correctIdx = parseInt(match[4]);

        // Parse options array
        const options = [];
        const optRegex = /"([^"]*)"/g;
        let optMatch;
        while ((optMatch = optRegex.exec(optionsRaw)) !== null) {
          options.push(optMatch[1].trim());
        }

        // Skip if invalid
        if (!questionText || options.length < 2 || correctIdx >= options.length) {
          console.warn(`[htmlParser] Skipping invalid question: "${questionText}"`);
          continue;
        }

        const correctAnswer = options[correctIdx];
        const cat = CAT_MAP[rawCat] || rawCat.replace(/[\u{1F300}-\u{1F9FF}]/gu, "").trim();

        // Determine difficulty based on question complexity
        let diff = "medium";
        if (options.length <= 3 || questionText.length < 20) diff = "easy";
        if (questionText.includes("متى") || questionText.includes("مؤسس") || questionText.includes("فاتح")) diff = "hard";

        questions.push({
          id: idCounter++,
          cat,
          diff,
          q: questionText,
          a: correctAnswer,
          opts: options,
          correctIdx,
        });
      } catch (err) {
        console.warn(`[htmlParser] Error parsing question:`, err.message);
      }
    }
  }

  // ── Strategy 2: Look for any other question patterns ──
  // Check for questions in other formats (data attributes, JSON blocks, etc.)
  const jsonBlockRegex = /(?:questions|QUESTIONS|questionBank)\s*[:=]\s*\[([\s\S]*?)\];/g;
  let blockMatch;
  while ((blockMatch = jsonBlockRegex.exec(html)) !== null) {
    if (blockMatch[0].includes("AQ")) continue; // Already parsed
    try {
      const parsed = JSON.parse("[" + blockMatch[1] + "]");
      for (const item of parsed) {
        if (item.q && item.a) {
          questions.push({
            id: idCounter++,
            cat: item.cat || "عامة",
            diff: item.diff || "medium",
            q: item.q,
            a: item.a,
            opts: item.opts || item.o || [],
            correctIdx: item.c || 0,
          });
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // ── Deduplication ──
  const seen = new Set();
  const unique = questions.filter(q => {
    const key = q.q.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[htmlParser] Parsed ${unique.length} questions from ${path.basename(filePath)}`);

  // Log categories breakdown
  const cats = {};
  unique.forEach(q => { cats[q.cat] = (cats[q.cat] || 0) + 1; });
  Object.entries(cats).forEach(([c, n]) => console.log(`  ${c}: ${n}`));

  return unique;
}

/**
 * Convert parsed questions to the game's text-answer format
 * (strips multiple choice, keeps only correct answer for fuzzy matching)
 */
function toGameFormat(parsedQuestions) {
  return parsedQuestions.map(q => ({
    id: q.id,
    cat: q.cat,
    diff: q.diff,
    q: q.q,
    a: q.a,
  }));
}

/**
 * Load and parse on startup — cached in memory
 */
let _cache = null;

function loadFromHTML(filePath) {
  if (_cache) return _cache;

  const defaultPath = filePath || path.join(__dirname, "..", "s&g.html");
  if (!fs.existsSync(defaultPath)) {
    console.log(`[htmlParser] File not found: ${defaultPath} — skipping`);
    return [];
  }

  const parsed = parseHTML(defaultPath);
  _cache = toGameFormat(parsed);
  return _cache;
}

module.exports = { parseHTML, toGameFormat, loadFromHTML };
