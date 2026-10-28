// routes/competitions.js
// Competitions for the app: the home "推薦競賽" row and the 競賽組隊媒合 list.
//
//   GET /competitions?category=DESIGN&offset=0&limit=5
//       Open competitions (deadline not passed), nearest deadline first, one page
//       at a time. category is optional: CASE / HACKATHON / PITCH / DESIGN / RESEARCH.
//       -> { items, total, offset, hasMore }
//   GET /competitions/recommended?limit=5
//       Open competitions ranked for the signed-in user (interests, skills,
//       department). -> { items }
//   GET /competitions/:id
//       One competition by sourceId, expired ones included. -> the item itself
//
// Reads the `competitions` collection written by scripts/ingest-competitions.js.
// The id the app sees is sourceId: the c1..c65 `id` field is display order and
// shifts on a re-crawl, and /ai/skills/reinforce also returns sourceId as resourceId.

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');

// Must match CompetitionCategory in the app's Models.kt.
const CATEGORIES = ['CASE', 'HACKATHON', 'PITCH', 'DESIGN', 'RESEARCH'];
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
// Recommendations put competitions closing within this many days last, so the
// home row does not suggest one that closes today.
const MIN_DAYS_LEFT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECTION = {
  sourceId: 1,
  sourceUrl: 1,
  title: 1,
  organizer: 1,
  category: 1,
  deadline: 1,
  deadlineIsoDate: 1,
  teamSize: 1,
  prize: 1,
  tags: 1,
  skills: 1,
  coverColor: 1,
  coverImageUrl: 1,
};

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// There is no Mongoose model for competitions, and this route only reads,
// so it uses the collection directly.
function collection() {
  return mongoose.connection.db.collection('competitions');
}

// Integer query parameter with a fallback, kept within [min, max].
function intParam(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Covers stored as "/covers/<file>" (served from public/covers) need this
// server's address, which differs per machine and device (10.0.2.2, a LAN IP...).
function absoluteUrl(url, req) {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('/')) return `${req.protocol}://${req.get('host')}${url}`;
  return url;
}

function stringList(v) {
  return Array.isArray(v)
    ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
    : [];
}

// Field names match Competition in the app's Models.kt.
function toDto(d, req) {
  return {
    id: d.sourceId,
    title: d.title || '',
    organizer: d.organizer || '',
    category: d.category || '',
    deadline: d.deadline || '',
    teamSize: d.teamSize || '',
    prize: d.prize || '',
    tags: stringList(d.tags),
    skills: stringList(d.skills),
    coverColor: d.coverColor || 'orange',
    coverImageUrl: absoluteUrl(d.coverImageUrl, req),
    sourceUrl: d.sourceUrl || '',
  };
}

// ---------------------------------------------------------------- recommendation

// Hand-made category affinities for the app's onboarding options
// (MockData.jobInterests and MockData.skills). Interests and skills outside
// these lists still count through the keyword match in keywordHits().
const INTEREST_CATEGORIES = {
  行銷企劃: ['CASE', 'PITCH'],
  資料分析: ['HACKATHON', 'RESEARCH', 'CASE'],
  使用者研究: ['RESEARCH', 'DESIGN'],
  產品經理: ['PITCH', 'HACKATHON'],
  軟體工程: ['HACKATHON'],
  視覺設計: ['DESIGN'],
  人力資源: ['CASE'],
  業務開發: ['CASE', 'PITCH'],
  財務管理: ['CASE'],
  內容創作: ['DESIGN', 'PITCH'],
  客戶成功: ['CASE'],
  營運專案: ['CASE', 'PITCH'],
};

const SKILL_CATEGORIES = {
  Excel: ['CASE'],
  SQL: ['HACKATHON'],
  Python: ['HACKATHON', 'RESEARCH'],
  Figma: ['DESIGN'],
  簡報製作: ['CASE', 'PITCH'],
  數據視覺化: ['HACKATHON', 'RESEARCH'],
  專案管理: ['PITCH'],
  提案撰寫: ['PITCH', 'CASE'],
  使用者訪談: ['RESEARCH', 'DESIGN'],
  'A/B 測試': ['RESEARCH'],
  SEO: ['CASE'],
  廣告投放: ['CASE'],
  Tableau: ['HACKATHON', 'RESEARCH'],
};

// The department field is free text ("資管系", "MIS", "企管"), so match keywords.
const DEPARTMENT_RULES = [
  { pattern: /資管|資工|資訊|電機|電子|通訊|數學|統計|\bmis|\bcs\b|\bee\b/i, categories: ['HACKATHON', 'RESEARCH'] },
  { pattern: /設計|建築|視傳|美術|藝術|景觀/, categories: ['DESIGN'] },
  { pattern: /企管|財管|財金|財務|會計|金融|行銷|國企|經濟|管理|商/, categories: ['CASE', 'PITCH'] },
];

function profileOf(user) {
  return {
    interests: stringList(user && user.interests),
    skills: [...new Set([...stringList(user && user.skillsHave), ...stringList(user && user.skillsWant)])],
    department: user && typeof user.department === 'string' ? user.department : '',
  };
}

// Points per category: 2 for each matching interest, 1 for each skill, 1 for the department.
function categoryWeights(profile) {
  const weights = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const add = (cats, points) => (cats || []).forEach((c) => { weights[c] += points; });
  profile.interests.forEach((i) => add(INTEREST_CATEGORIES[i], 2));
  profile.skills.forEach((s) => add(SKILL_CATEGORIES[s], 1));
  DEPARTMENT_RULES.forEach((r) => {
    if (r.pattern.test(profile.department)) add(r.categories, 1);
  });
  return weights;
}

// How many of the user's interests and skills appear in the title, tags or skills.
function keywordHits(doc, keywords) {
  const text = [doc.title, ...stringList(doc.tags), ...stringList(doc.skills)].join(' ').toLowerCase();
  return keywords.filter((k) => text.includes(k.toLowerCase())).length;
}

// Highest score first, then the nearest deadline. Competitions that close within
// MIN_DAYS_LEFT days only fill the row when there are not enough others.
// With an empty profile every score is 0, so this is simply "closing soonest".
function rankForUser(docs, profile, now, limit) {
  const weights = categoryWeights(profile);
  const keywords = [...profile.interests, ...profile.skills].filter((k) => k.length >= 2);
  const soon = new Date(now.getTime() + MIN_DAYS_LEFT * DAY_MS);
  return docs
    .map((doc) => ({
      doc,
      late: doc.deadlineIsoDate < soon ? 1 : 0,
      score: (weights[doc.category] || 0) + 3 * keywordHits(doc, keywords),
    }))
    .sort((a, b) => a.late - b.late || b.score - a.score || a.doc.deadlineIsoDate - b.doc.deadlineIsoDate)
    .slice(0, limit)
    .map((x) => x.doc);
}

// ---------------------------------------------------------------- routes

// GET /competitions — open competitions, nearest deadline first, paged.
router.get('/', requireAuth, async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category.trim().toUpperCase() : '';
  if (category && !CATEGORIES.includes(category)) {
    return fail(res, 422, 'validation_error', `category 只能是 ${CATEGORIES.join(', ')}`);
  }
  const offset = intParam(req.query.offset, 0, 0, 100000);
  const limit = intParam(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const filter = { deadlineIsoDate: { $gte: new Date() } };
  if (category) filter.category = category;

  try {
    const col = collection();
    const [docs, total] = await Promise.all([
      // _id breaks ties so pages never repeat or skip rows with the same deadline.
      col.find(filter, { projection: PROJECTION })
        .sort({ deadlineIsoDate: 1, _id: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      col.countDocuments(filter),
    ]);
    return res.json({
      items: docs.map((d) => toDto(d, req)),
      total,
      offset,
      hasMore: offset + docs.length < total,
    });
  } catch (err) {
    console.error('GET /competitions', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /competitions/recommended — the home row. Must stay above /:id.
router.get('/recommended', requireAuth, async (req, res) => {
  const limit = intParam(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const now = new Date();
  try {
    const [user, docs] = await Promise.all([
      User.findById(req.userId).select('interests skillsHave skillsWant department').lean(),
      collection().find({ deadlineIsoDate: { $gte: now } }, { projection: PROJECTION }).toArray(),
    ]);
    const items = rankForUser(docs, profileOf(user), now, limit);
    return res.json({ items: items.map((d) => toDto(d, req)) });
  } catch (err) {
    console.error('GET /competitions/recommended', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /competitions/:id — one competition by sourceId.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const doc = await collection().findOne({ sourceId: req.params.id }, { projection: PROJECTION });
    if (!doc) return fail(res, 404, 'not_found', '找不到這個競賽');
    return res.json(toDto(doc, req));
  } catch (err) {
    console.error('GET /competitions/:id', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

module.exports = router;