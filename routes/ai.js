const express = require('express');
const router = express.Router();
const Experience = require('../models/Experience');
const requireAuth = require('../middleware/requireAuth');

const AI_URL = process.env.AI_SERVICE_URL;

function toAiExperience(doc) {
  const d = doc.description || {};
  return {
    id: doc._id.toString(),
    title: doc.title,
    category: doc.category,
    timeRange: doc.timeRange || '',
    description: [d.role, d.action, d.result, d.learning].filter(Boolean).join(' '),
    tags: doc.tags || [],
  };
}

async function callAi(path, body) {
  const r = await fetch(`${AI_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000), // match the AI service's own 60s LLM timeout
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// POST /ai/resume/customize   body: { jobId }
router.post('/resume/customize', requireAuth, async (req, res) => {
  console.log('body:', req.body);
  const { jobId } = req.body ?? {};
  if (!jobId) {
    return res.status(422).json({ error: { code: 'validation_error', message: '請提供 jobId' } });
  }
  try {
    const docs = await Experience.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    const { ok, status, data } = await callAi('/resume/customize', {
      userId: String(req.userId),
      jobId,
      experiences: docs.map(toAiExperience),
    });
    if (!ok) {
      return res.status(status === 404 ? 404 : 502).json(
        data.error ? data : { error: { code: 'ai_upstream_error', message: 'AI 服務回應錯誤' } }
      );
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    const timedOut = err.name === 'TimeoutError';
    return res.status(timedOut ? 504 : 502).json({
      error: { code: timedOut ? 'ai_timeout' : 'ai_unavailable', message: 'AI 服務暫時無法回應，請稍後再試' },
    });
  }
});

// POST /ai/skills/reinforce   body: { missingSkills: string[] }
router.post('/skills/reinforce', requireAuth, async (req, res) => {
  const { missingSkills } = req.body ?? {};
  if (!Array.isArray(missingSkills) || missingSkills.length === 0
      || !missingSkills.every((s) => typeof s === 'string')) {
    return res.status(422).json({ error: { code: 'validation_error', message: '請提供 missingSkills' } });
  }
  try {
    const { ok, status, data } = await callAi('/skills/reinforce', {
      userId: String(req.userId),
      missingSkills,
      school: 'nsysu',
    });
    if (!ok) {
      return res.status(status === 404 ? 404 : 502).json(
        data?.error ? data : { error: { code: 'ai_upstream_error', message: 'AI 服務回應錯誤' } }
      );
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    const timedOut = err.name === 'TimeoutError';
    return res.status(timedOut ? 504 : 502).json({
      error: { code: timedOut ? 'ai_timeout' : 'ai_unavailable', message: 'AI 服務暫時無法回應，請稍後再試' },
    });
  }
});

// POST /ai/career/recommend   body: { query? }
// The AI service rejects an empty query (min_length 1). The career page has no
// free-text input wired to this yet, so fall back to a neutral description.
const DEFAULT_RECOMMEND_QUERY = '依我的經歷推薦適合的職涯方向';

router.post('/career/recommend', requireAuth, async (req, res) => {
  const rawQuery = req.body?.query;
  if (rawQuery != null && typeof rawQuery !== 'string') {
    return res.status(422).json({ error: { code: 'validation_error', message: 'query 必須是字串' } });
  }
  const query = (rawQuery ?? '').trim() || DEFAULT_RECOMMEND_QUERY;
  try {
    const docs = await Experience.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    const { ok, status, data } = await callAi('/career/recommend', {
      userId: String(req.userId),
      query,
      experiences: docs.map(toAiExperience),
    });
    if (!ok) {
      console.error('career/recommend upstream', status, JSON.stringify(data));
      return res.status(502).json(
        data?.error ? data : { error: { code: 'ai_upstream_error', message: 'AI 服務回應錯誤' } }
      );
    }
    // An empty list is a normal answer: no direction scored high enough.
    return res.status(200).json({
      recommendations: Array.isArray(data?.recommendations) ? data.recommendations : [],
    });
  } catch (err) {
    console.error(err);
    const timedOut = err.name === 'TimeoutError';
    return res.status(timedOut ? 504 : 502).json({
      error: { code: timedOut ? 'ai_timeout' : 'ai_unavailable', message: 'AI 服務暫時無法回應，請稍後再試' },
    });
  }
});

module.exports = router;