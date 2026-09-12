const express = require('express');
const router = express.Router();
const Experience = require('../models/Experience');
const requireAuth = require('../middleware/requireAuth');

// Where the model team's FastAPI service lives. In an env var so a deployed
// build can point elsewhere without a code change.
const AI_BASE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// Recommend runs a vector search plus one or two LLM calls. Measured locally
// at ~27s because the service re-embeds part of the KB on each request, so the
// handover doc's "2-10s" is optimistic. 60s leaves room without hanging a
// client forever.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// Reshape a stored experience into the AI service's ExperienceIn.
//
// Its schema declares `description` as a plain string, while the collection
// stores role/action/result/learning as a subdocument, so the fields are
// flattened here. Documents written before the schema refactor still carry the
// old flat fields and `period` at the top level; `_doc` reaches them because
// Mongoose strips fields the current schema does not declare.
//
// `learning` is left out on purpose: it records what the person took away
// personally, which is reflection material rather than something a recommender
// should match job requirements against.
function toExperienceIn(exp) {
  const raw = exp._doc || exp;
  const d = exp.description || {};
  const action = d.action || raw.action || '';
  const result = d.result || raw.result || '';
  const role = d.role || raw.role || '';

  return {
    id: exp._id.toString(),
    title: exp.title || '',
    category: exp.category || '',
    timeRange: exp.timeRange || raw.period || '',
    description: [role, action, result].filter(Boolean).join('。'),
    tags: Array.isArray(exp.tags) ? exp.tags : [],
  };
}

// POST /career/recommend   body: { query: string }
//
// The client sends only the free-text goal the user typed. userId comes from
// the token and the experience list is assembled here, so the app never has to
// hold or forward the user's full experience data just to get a recommendation.
router.post('/recommend', requireAuth, async (req, res) => {
  try {
    const query = (req.body?.query || '').trim();
    if (!query) {
      return fail(res, 422, 'validation_error', '請輸入你想了解的方向');
    }

    const docs = await Experience.find({ userId: req.userId }).sort({ createdAt: -1 });
    const experiences = docs.map(toExperienceIn);

    const aiRes = await fetch(`${AI_BASE_URL}/career/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: req.userId, query, experiences }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      console.error('AI service error:', aiRes.status, detail);
      return fail(res, 502, 'ai_unavailable', 'AI 服務暫時無法回應，請稍後再試');
    }

    const data = await aiRes.json();

    // With no experiences the AI service answers from its golden fixture, which
    // looks like a real result but is not personalised. Flag it so the client
    // can prompt the user to add experiences instead of silently showing canned
    // recommendations as if they were theirs.
    return res.json({
      ...data,
      experienceCount: experiences.length,
      isPersonalized: experiences.length > 0,
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.error('AI service timeout after', AI_TIMEOUT_MS, 'ms');
      return fail(res, 504, 'ai_timeout', 'AI 服務回應逾時，請稍後再試');
    }
    // fetch throws this when nothing is listening on AI_BASE_URL — in
    // development that usually just means uvicorn is not running.
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('AI service unreachable at', AI_BASE_URL);
      return fail(res, 503, 'ai_not_running', 'AI 服務未啟動，請聯繫後端');
    }
    console.error('POST /career/recommend', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /career/health — is the AI service reachable?
// Useful before a demo: check this instead of discovering the service is down
// through a 60-second timeout on a real request.
router.get('/health', async (req, res) => {
  try {
    const r = await fetch(`${AI_BASE_URL}/docs`, { signal: AbortSignal.timeout(5000) });
    return res.json({ aiService: r.ok ? 'up' : 'error', url: AI_BASE_URL });
  } catch (err) {
    return res.status(503).json({ aiService: 'down', url: AI_BASE_URL });
  }
});

module.exports = router;
