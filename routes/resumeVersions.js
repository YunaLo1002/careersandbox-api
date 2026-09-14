const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const ResumeVersion = require('../models/ResumeVersion');
const requireAuth = require('../middleware/requireAuth');

// Every route here is owner-scoped. userId always comes from the token, never
// from the request body or the URL: a client-supplied userId would let anyone
// read, overwrite or delete another user's resume versions.

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function badId(res) {
  return fail(res, 404, 'not_found', '找不到這個履歷版本');
}

// POST /resume-versions — save a customized version
router.post('/', requireAuth, async (req, res) => {
  try {
    const { jobId, jdSnapshot, items, label } = req.body ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 422, 'validation_error', 'items 不可為空');
    }
    // One of the two JD paths must be present: an in-app job, or a pasted JD
    // stored as a snapshot so the version stays readable if the posting changes.
    if (!jobId && !jdSnapshot) {
      return fail(res, 422, 'validation_error', '需要 jobId 或 jdSnapshot 其中之一');
    }

    const version = await ResumeVersion.create({
      userId: req.userId,
      jobId: jobId || '',
      jdSnapshot: jdSnapshot || '',
      label: label || '',
      items: items.map((it) => ({
        experienceId: it.experienceId || undefined,
        text: it.text || '',
        matchedKeywords: Array.isArray(it.matchedKeywords) ? it.matchedKeywords : [],
        highlighted: Boolean(it.highlighted),
      })),
    });

    return res.status(201).json(version);
  } catch (err) {
    console.error('POST /resume-versions', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /resume-versions — the caller's own versions, newest first
router.get('/', requireAuth, async (req, res) => {
  try {
    const versions = await ResumeVersion.find({ userId: req.userId }).sort({ createdAt: -1 });
    return res.json(versions);
  } catch (err) {
    console.error('GET /resume-versions', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /resume-versions/job/:jobId — the caller's versions for one job
router.get('/job/:jobId', requireAuth, async (req, res) => {
  try {
    const versions = await ResumeVersion.find({
      userId: req.userId,
      jobId: req.params.jobId,
    }).sort({ createdAt: -1 });
    return res.json(versions);
  } catch (err) {
    console.error('GET /resume-versions/job/:jobId', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /resume-versions/:versionId
router.get('/:versionId', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.versionId)) return badId(res);
    const version = await ResumeVersion.findOne({
      _id: req.params.versionId,
      userId: req.userId, // ownership check
    });
    if (!version) return badId(res);
    return res.json(version);
  } catch (err) {
    console.error('GET /resume-versions/:versionId', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// PATCH /resume-versions/:versionId — partial update of the caller's own version
router.patch('/:versionId', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.versionId)) return badId(res);

    // Whitelist. userId is never writable.
    const updates = {};
    for (const key of ['jobId', 'jdSnapshot', 'label', 'items']) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.items !== undefined && !Array.isArray(updates.items)) delete updates.items;
    if (Object.keys(updates).length === 0) {
      return fail(res, 422, 'validation_error', '沒有可更新的欄位');
    }

    const version = await ResumeVersion.findOneAndUpdate(
      { _id: req.params.versionId, userId: req.userId }, // ownership check
      updates,
      { new: true, runValidators: true }
    );
    if (!version) return badId(res);
    return res.json(version);
  } catch (err) {
    console.error('PATCH /resume-versions/:versionId', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// DELETE /resume-versions/:versionId
router.delete('/:versionId', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.versionId)) return badId(res);
    const deleted = await ResumeVersion.findOneAndDelete({
      _id: req.params.versionId,
      userId: req.userId, // ownership check
    });
    if (!deleted) return badId(res);
    return res.json({ id: deleted._id.toString(), deleted: true });
  } catch (err) {
    console.error('DELETE /resume-versions/:versionId', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

module.exports = router;
