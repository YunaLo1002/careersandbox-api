const express = require('express');
const InterviewSession = require('../models/InterviewSession');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const MODES = ['single', 'panel', 'group'];

const serverError = (res, err) => {
  console.error(err);
  return res.status(500).json({ error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' } });
};

// POST /interview-sessions — save a finished interview (idempotent per sessionId)
router.post('/', requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const { sessionId, report } = body;
    const mode = body.mode ?? report?.mode;
    if (!sessionId || typeof sessionId !== 'string' || !report || typeof report !== 'object') {
      return res.status(422).json({ error: { code: 'validation_error', message: '缺少 sessionId 或 report' } });
    }
    if (!MODES.includes(mode)) {
      return res.status(422).json({ error: { code: 'validation_error', message: 'mode 必須是 single、panel 或 group' } });
    }
    const doc = await InterviewSession.findOneAndUpdate(
      { sessionId, userId: req.userId }, // userId comes from the token, never the body
      {
        mode,
        report,
        config: body.config && typeof body.config === 'object' ? body.config : {},
        participants: Array.isArray(body.participants) ? body.participants : [],
        turns: Array.isArray(body.turns) ? body.turns : [],
        groupSays: Array.isArray(body.groupSays) ? body.groupSays : [],
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    return res.status(201).json(toDetail(doc));
  } catch (err) {
    // The same sessionId was already saved by another user
    if (err.code === 11000) {
      return res.status(409).json({ error: { code: 'conflict', message: '這個 sessionId 已被使用' } });
    }
    return serverError(res, err);
  }
});

// GET /interview-sessions — the caller's history, newest first
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await InterviewSession.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select('sessionId mode config overallScore createdAt');
    return res.status(200).json(items.map((s) => ({
      id: s.sessionId,
      mode: s.mode,
      jobTitle: s.config?.targetJobTitle ?? '',
      score: s.overallScore, // null until the team decides
      createdAt: s.createdAt,
    })));
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /interview-sessions/:sessionId — one full report owned by the caller
router.get('/:sessionId', requireAuth, async (req, res) => {
  try {
    const doc = await InterviewSession.findOne({ sessionId: req.params.sessionId, userId: req.userId });
    if (!doc) return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆面試紀錄' } });
    return res.status(200).json(toDetail(doc));
  } catch (err) {
    return serverError(res, err);
  }
});

function toDetail(doc) {
  return {
    id: doc.sessionId,
    mode: doc.mode,
    score: doc.overallScore,
    config: doc.config,
    participants: doc.participants,
    turns: doc.turns,
    groupSays: doc.groupSays,
    report: doc.report,
    createdAt: doc.createdAt,
  };
}

module.exports = router;
