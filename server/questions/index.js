// ═══════════════════════════════════════════════════════════════
// Question Bank Index — Combines all 20 categories, deduplicates
// ═══════════════════════════════════════════════════════════════

const all = [
  ...require("./science"),      // 1-250     علوم
  ...require("./history"),      // 251-500   تاريخ
  ...require("./geography"),    // 501-750   جغرافيا
  ...require("./math"),         // 751-1000  رياضيات
  ...require("./literature"),   // 1001-1250 أدب
  ...require("./technology"),   // 1251-1500 تكنولوجيا
  ...require("./health"),       // 1501-1750 صحة
  ...require("./sports"),       // 1751-2000 رياضة
  ...require("./culture"),      // 2001-2250 ثقافة
  ...require("./religion"),     // 2251-2500 إسلام
  ...require("./politics"),     // 2501-2750 سياسة
  ...require("./economics"),    // 2751-3000 اقتصاد
  ...require("./general"),      // 3001-3250 معلومات عامة
  ...require("./space"),        // 3251-3500 فضاء
  ...require("./animals"),      // 3501-3750 حيوانات
  ...require("./food"),         // 3751-4000 طعام
  ...require("./music"),        // 4001-4250 موسيقى
  ...require("./art"),          // 4251-4500 فنون
  ...require("./law"),          // 4501-4750 قانون
  ...require("./philosophy"),   // 4751-5000 فلسفة
];

// Deduplicate by question text (keep first occurrence)
const seen = new Set();
const unique = [];
for (const q of all) {
  if (!seen.has(q.q)) {
    seen.add(q.q);
    unique.push(q);
  }
}

module.exports = unique;
