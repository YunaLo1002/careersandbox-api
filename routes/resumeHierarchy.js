const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const User = require('../models/User');
const Experience = require('../models/Experience');
const JobTarget = require('../models/JobTarget');
const ResumeVersion = require('../models/ResumeVersion');
const requireAuth = require('../middleware/requireAuth');

// Serves the three-tier structure defined in the Android client's
// ResumeHierarchyProvider (data/mock/ResumeHierarchy.kt): master -> targets ->
// versions. Field names mirror that interface so the client can swap
// MockResumeHierarchyProvider for a real one without touching any UI.

// Must stay identical to SubmissionStatus in ResumeHierarchy.kt. Kotlin enums
// are fixed at compile time, so an unknown value fails to parse.
const STATUS = ['DRAFT', 'SUBMITTED', 'INTERVIEWING', 'WAITING', 'REJECTED', 'OFFER'];

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function badId(res) {
  return fail(res, 404, 'not_found', '找不到這筆資料');
}

function toVersionDto(v) {
  return {
    id: v._id.toString(),
    label: v.label || '',
    status: v.status || 'DRAFT',
    // The client declares submittedDate as String?, so send a plain date
    // string or null, not an ISO timestamp it would have to reparse.
    submittedDate: v.submittedDate
      ? v.submittedDate.toISOString().slice(0, 10).replace(/-/g, '/')
      : null,
    note: v.note || '',
  };
}

function toTargetDto(t, versions) {
  return {
    id: t._id.toString(),
    title: t.title,
    company: t.company,
    jdKeywords: t.jdKeywords || [],
    versions: versions.map(toVersionDto),
  };
}

// GET /resume/master — the material pool.
// Assembled rather than stored: the master is a view over the user's profile
// and experiences, so there is nothing to keep in sync.
router.get('/master', requireAuth, async (req, res) => {
  try {
    const [user, count] = await Promise.all([
      User.findById(req.userId),
      Experience.countDocuments({ userId: req.userId }),
    ]);
    if (!user) return fail(res, 404, 'not_found', '找不到使用者資料');

    return res.json({
      ownerName: user.name || '',
      experienceCount: count,
      skills: user.skillsHave || [],
    });
  } catch (err) {
    console.error('GET /resume/master', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// GET /resume/targets — every target with its versions, newest first.
router.get('/targets', requireAuth, async (req, res) => {
  try {
    const targets = await JobTarget.find({ userId: req.userId }).sort({ updatedAt: -1 });
    if (targets.length === 0) return res.json([]);

    // One query for all versions instead of one per target.
    const versions = await ResumeVersion.find({
      targetId: { $in: targets.map((t) => t._id) },
    }).sort({ createdAt: 1 });

    const byTarget = new Map();
    for (const v of versions) {
      const key = String(v.targetId);
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(v);
    }

    return res.json(targets.map((t) => toTargetDto(t, byTarget.get(String(t._id)) || [])));
  } catch (err) {
    console.error('GET /resume/targets', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// POST /resume/targets
router.post('/targets', requireAuth, async (req, res) => {
  try {
    const { title, company, jdKeywords, jobId, jdSnapshot, deadline } = req.body ?? {};
    if (!title || !company) {
      return fail(res, 422, 'validation_error', '請填寫職位名稱與公司');
    }

    const target = await JobTarget.create({
      userId: req.userId,
      title,
      company,
      jdKeywords: Array.isArray(jdKeywords) ? jdKeywords : [],
      jobId: jobId || '',
      jdSnapshot: jdSnapshot || '',
      deadline: deadline || null,
    });

    return res.status(201).json(toTargetDto(target, []));
  } catch (err) {
    console.error('POST /resume/targets', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// PATCH /resume/targets/:id
router.patch('/targets/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return badId(res);

    const updates = {};
    for (const k of ['title', 'company', 'jdKeywords', 'jobId', 'jdSnapshot', 'deadline']) {
      if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    }
    if (Object.keys(updates).length === 0) {
      return fail(res, 422, 'validation_error', '沒有可更新的欄位');
    }

    const target = await JobTarget.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      updates,
      { new: true, runValidators: true }
    );
    if (!target) return badId(res);

    const versions = await ResumeVersion.find({ targetId: target._id }).sort({ createdAt: 1 });
    return res.json(toTargetDto(target, versions));
  } catch (err) {
    console.error('PATCH /resume/targets/:id', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// DELETE /resume/targets/:id — removes the target and every version under it.
router.delete('/targets/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return badId(res);

    const target = await JobTarget.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!target) return badId(res);

    // MongoDB has no foreign keys, so the cascade is manual.
    const r = await ResumeVersion.deleteMany({ targetId: target._id });
    return res.json({ id: target._id.toString(), deleted: true, versionsDeleted: r.deletedCount });
  } catch (err) {
    console.error('DELETE /resume/targets/:id', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// POST /resume/targets/:id/versions — save a customization as a new version.
router.post('/targets/:id/versions', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return badId(res);

    const target = await JobTarget.findOne({ _id: req.params.id, userId: req.userId });
    if (!target) return badId(res);

    const { label, note, items } = req.body ?? {};

    // Label defaults to 版本 A / B / C, matching the client's own numbering.
    const existing = await ResumeVersion.countDocuments({ targetId: target._id });
    const autoLabel = `版本 ${String.fromCharCode(65 + existing)}`;

    const version = await ResumeVersion.create({
      userId: req.userId,
      targetId: target._id,
      jobId: target.jobId || '',
      jdSnapshot: target.jdSnapshot || '',
      label: label || autoLabel,
      note: note || '',
      status: 'DRAFT',
      items: Array.isArray(items)
        ? items.map((it) => ({
            experienceId: it.experienceId || undefined,
            text: it.text || '',
            matchedKeywords: Array.isArray(it.matchedKeywords) ? it.matchedKeywords : [],
            highlighted: Array.isArray(it.highlighted) ? it.highlighted : [],
          }))
        : [],
    });

    return res.status(201).json(toVersionDto(version));
  } catch (err) {
    console.error('POST /resume/targets/:id/versions', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// PATCH /resume/versions/:vid/status
//
// Any of the six values is accepted in any order. The client's status picker
// lets the user choose freely, so rejecting "illegal" transitions here would
// turn a legitimate UI action into a 409.
router.patch('/versions/:vid/status', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.vid)) return badId(res);

    const { status } = req.body ?? {};
    if (!STATUS.includes(status)) {
      return fail(res, 422, 'validation_error', `status 必須是 ${STATUS.join(' / ')}`);
    }

    const version = await ResumeVersion.findOne({ _id: req.params.vid, userId: req.userId });
    if (!version) return badId(res);

    version.status = status;
    // Stamp the first time it is marked as sent; later changes keep the
    // original date, since that is when the application actually went out.
    if (status === 'SUBMITTED' && !version.submittedDate) {
      version.submittedDate = new Date();
    }
    await version.save();

    return res.json(toVersionDto(version));
  } catch (err) {
    console.error('PATCH /resume/versions/:vid/status', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

// DELETE /resume/versions/:vid
router.delete('/versions/:vid', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.vid)) return badId(res);
    const deleted = await ResumeVersion.findOneAndDelete({
      _id: req.params.vid,
      userId: req.userId,
    });
    if (!deleted) return badId(res);
    return res.json({ id: deleted._id.toString(), deleted: true });
  } catch (err) {
    console.error('DELETE /resume/versions/:vid', err);
    return fail(res, 500, 'internal_error', '服務暫時無法回應，請稍後再試');
  }
});

module.exports = router;
