// utils/experienceTags.js
//
// Generate skill tags for one experience with the OpenAI API and write them
// back. A tag must be a name from skills_v1.json (copied from
// CareerSandboxModule fixtures/vocab/): the interview service and the AI
// service only count tags that match a vocabulary name or alias.

const Experience = require('../models/Experience');
const VOCAB = require('./skills_v1.json');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TAGS = 8;

// Fold full/half width and case, drop spaces and punctuation. + and # stay,
// otherwise "C#" shrinks to "c" and is found inside "Excel".
function norm(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]/gu, '');
}

// Normalized name or alias -> the vocabulary name that is stored in tags.
const LOOKUP = new Map();
for (const s of VOCAB) LOOKUP.set(norm(s.name_zh), s.name_zh);
for (const s of VOCAB) {
  for (const a of s.aliases || []) {
    if (!LOOKUP.has(norm(a))) LOOKUP.set(norm(a), s.name_zh);
  }
}

const SYSTEM_PROMPT = `你要從一段求職履歷的經歷裡，挑出這個人實際用過或做過的技能。只能從最後的技能清單裡挑。

規則：
1. 只挑經歷裡寫出來、或明確描述他做過的技能。不要從職稱、活動類型或常理推測，例如只寫「擔任行銷組長」不代表他會 SEO。
2. name 照清單上的寫法原樣寫，清單外的技能不要寫。
3. quote 從經歷原文直接複製一段能證明的文字，不要改寫、不要摘要，也不要帶「做了什麼：」這類欄位名稱。
4. 不確定就不要挑，寧可少挑。最多 8 個。
5. 只輸出一個 JSON 物件，格式：{"tags":[{"name":"技能名稱","quote":"經歷原文片段"}]}。一個都沒有就輸出 {"tags":[]}。

技能清單（一行一個）：
${VOCAB.map((s) => s.name_zh).join('\n')}`;

// The four fields toExperienceIn sends to the AI service. "learning" is left
// out: writing that you learned teamwork is not evidence that you did it.
function experienceFields(exp) {
  const raw = exp._doc || exp; // documents from before the schema refactor
  const d = exp.description || {};
  return [
    ['標題', exp.title],
    ['角色', d.role || raw.role],
    ['做了什麼', d.action || raw.action],
    ['成果', d.result || raw.result],
  ].filter(([, v]) => v);
}

// Keep a tag only if its name is in the vocabulary and its quote really is in
// the experience. Returns what was kept and what was dropped, with the reason.
function pickTags(items, text) {
  const hay = norm(text);
  const kept = [];
  const dropped = [];
  for (const t of items) {
    const name = LOOKUP.get(norm(t?.name));
    const quote = norm(t?.quote);
    let why = '';
    if (!name) why = 'not in vocabulary';
    else if (quote.length < 2 || !hay.includes(quote)) why = 'quote not in experience';
    else if (kept.some((k) => k.name === name)) why = 'duplicate';
    else if (kept.length >= MAX_TAGS) why = `over ${MAX_TAGS}`;
    if (why) dropped.push({ name: String(t?.name ?? ''), quote: String(t?.quote ?? ''), why });
    else kept.push({ name, quote: String(t.quote) });
  }
  return { kept, dropped };
}

async function askModel(userText) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  // Bad JSON or a missing tags array is a failure, not "no tags": returning []
  // here would wipe the tags an earlier save produced.
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '');
  if (!Array.isArray(parsed?.tags)) throw new Error('model output has no tags array');
  return parsed.tags;
}

/**
 * Generate tags for one experience document.
 * Returns null when OPENAI_API_KEY is not set (nothing is called or written),
 * otherwise { tags, kept, dropped, written }. Throws when the model call fails.
 * { write: false } only computes the tags; the backfill's --dry-run uses it.
 */
async function tagExperience(exp, { write = true } = {}) {
  if (!process.env.OPENAI_API_KEY) return null;
  const fields = experienceFields(exp);
  const userText = fields.map(([label, v]) => `${label}：${v}`).join('\n');
  const { kept, dropped } = pickTags(await askModel(userText), fields.map(([, v]) => v).join('\n'));
  const tags = kept.map((k) => k.name);

  let written = false;
  if (write) {
    // Write only if the experience is unchanged since it was read, so a slow
    // result never overwrites a newer save. timestamps: false keeps this write
    // from bumping updatedAt itself.
    const r = await Experience.updateOne(
      { _id: exp._id, updatedAt: exp.updatedAt },
      { $set: { tags } },
      { timestamps: false },
    );
    written = r.matchedCount === 1;
  }
  return { tags, kept, dropped, written };
}

module.exports = { tagExperience, pickTags, norm };
