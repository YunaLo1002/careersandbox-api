const express = require('express');
const router = express.Router();

const InterviewSession = require('../models/InterviewSession');
const requireAuth = require('../middleware/requireAuth');

const MODES = ['single', 'panel', 'group'];

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);

// Keep order and duplicates exactly as sent: the order is the priority order.
const asStringArray = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);

// overallScore comes from the model service, either at the top level of the
// request or inside the report. Anything that is not a 0-100 number is
// treated as "not available yet" rather than rejected, so saving never fails
// because of the score.
function pickScore(body, report) {
  const raw = body.overallScore ?? report.overallScore;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
}

function toDetail(doc) {
  return {
    id: doc.sessionId,
    mode: doc.mode,
    score: doc.overallScore,
    scoreBasis: doc.scoreBasis || [],
    config: doc.config || {},
    participants: doc.participants || [],
    turns: doc.turns || [],
    groupSays: doc.groupSays || [],
    jdSkills: doc.jdSkills || [],
    report: doc.report,
    createdAt: doc.createdAt,
  };
}

// POST /interview-sessions — save (or re-save) one finished interview.
// Re-sending the same sessionId replaces that record; createdAt is kept.
router.post('/', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const { sessionId, report } = body;

  if (typeof sessionId !== 'string' || !sessionId || !isPlainObject(report)) {
    return fail(res, 422, 'validation_error', '缺少 sessionId 或 report');
  }

  const mode = body.mode ?? report.mode;
  if (!MODES.includes(mode)) {
    return fail(res, 422, 'validation_error', 'mode 必須是 single、panel 或 group');
  }

  try {
    const doc = await InterviewSession.findOneAndUpdate(
      // userId always comes from the token, never from the body.
      { sessionId, userId: req.userId },
      {
        mode,
        report,
        config: isPlainObject(body.config) ? body.config : {},
        participants: asArray(body.participants),
        turns: asArray(body.turns),
        groupSays: asArray(body.groupSays),
        jdSkills: asStringArray(body.jdSkills),
        overallScore: pickScore(body, report),
        scoreBasis: asStringArray(body.scoreBasis ?? report.scoreBasis),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
    return res.status(201).json(toDetail(doc));
  } catch (err) {
    // The sessionId exists but belongs to another user: the filter missed,
    // the upsert tried to insert, and the unique index refused it.
    if (err.code === 11000) {
      return fail(res, 409, 'conflict', '這個 sessionId 已被使用');
    }
    console.error('POST /interview-sessions', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /interview-sessions — the signed-in user's history, newest first.
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await InterviewSession.find({ userId: req.userId })
      .select('sessionId mode config overallScore createdAt')
      .sort({ createdAt: -1 });

    return res.json(
      docs.map((d) => ({
        id: d.sessionId,
        mode: d.mode,
        jobTitle: d.config?.targetJobTitle ?? '',
        score: d.overallScore,
        createdAt: d.createdAt,
      }))
    );
  } catch (err) {
    console.error('GET /interview-sessions', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /interview-sessions/:sessionId — one full record.
router.get('/:sessionId', requireAuth, async (req, res) => {
  try {
    const doc = await InterviewSession.findOne({
      sessionId: req.params.sessionId,
      userId: req.userId,
    });
    if (!doc) return fail(res, 404, 'not_found', '找不到這筆面試紀錄');
    return res.json(toDetail(doc));
  } catch (err) {
    console.error('GET /interview-sessions/:sessionId', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

module.exports = router;
