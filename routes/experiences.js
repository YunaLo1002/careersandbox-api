const express = require('express');
const mongoose = require('mongoose');
const Experience = require('../models/Experience');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /experiences — list the caller's own experiences, newest first
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await Experience.find({ userId: req.userId }).sort({ createdAt: -1 });
    return res.status(200).json(items.map(toDto));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      error: { 
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試' 
      } 
    })
  }
});

// POST /experiences — create one experience owned by the caller
router.post('/', requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    const { title, category, tags } = body;
    if (!title || !category) {
      return res.status(422).json({ error: { code: 'validation_error', message: '請填寫標題與類別' } });
    }
    const exp = await Experience.create({
      userId: req.userId, // from the token — never from the request body
      title,
      category,
      timeRange: readTimeRange(body),
      description: readDescription(body),
      tags: Array.isArray(tags) ? tags : [],
    });
    return res.status(201).json(toDto(exp));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      error: { 
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試' 
      } 
    })
  }
});

// GET /experiences/:id — fetch one of the caller's own experiences (for prefill)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆經歷' } });
    }
    const exp = await Experience.findOne({ _id: req.params.id, userId: req.userId });
    if (!exp) return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆經歷' } });
    return res.status(200).json(toDto(exp));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      error: { 
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試' 
      } 
    })
  }
});

// PATCH /experiences/:id — update one of the caller's own experiences
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆經歷' } });
    }
    // Whitelist, same rule as users PATCH
    const body = req.body ?? {};
    const updates = {};
    for (const key of ['title', 'category', 'tags']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (updates.tags !== undefined && !Array.isArray(updates.tags)) delete updates.tags;

    if (body.timeRange !== undefined || body.period !== undefined) {
      updates.timeRange = readTimeRange(body);
    }
    // Any of the four guided fields, flat or nested, rewrites the whole
    // description subdocument — the client always sends the complete form.
    const desc = readDescription(body);
    if (['role', 'action', 'result', 'learning'].some((k) => body[k] !== undefined) || body.description !== undefined) {
      updates.description = desc;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(422).json({ error: { code: 'validation_error', message: '沒有可更新的欄位' } });
    }
    const exp = await Experience.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId }, // ownership check
      updates,
      { new: true, runValidators: true },
    );
    if (!exp) return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆經歷' } });
    return res.status(200).json(toDto(exp));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      error: { 
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試' 
      } 
    })
  }
});

// DELETE /experiences/:id — delete one of the caller's own experiences
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // A malformed id would throw a CastError — treat it as "not found"
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆經歷' } });
    }
    const deleted = await Experience.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId, // ownership check — you can only delete your own
    });
    if (!deleted) {
      return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆經歷' } });
    }
    return res.status(200).json({ id: deleted._id.toString(), deleted: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      error: { 
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試' 
      } 
    })
  }
});

// Shape a MongoDB document into what the app expects.
// description is composed here so the list card needs no extra logic.
/**
 * Pull the four guided fields out of a request body.
 * Accepts them nested (description: {...}) or flat (role, action, ...) —
 * the Android form sends flat, the handover documents describe nested.
 */
function readDescription(body) {
  const d = body.description;
  const src = d && typeof d === 'object' ? d : body;
  return {
    role: src.role || '',
    action: src.action || '',
    result: src.result || '',
    learning: src.learning || '',
  };
}

/** timeRange is the current name; `period` was the pre-refactor name. */
function readTimeRange(body) {
  return body.timeRange || body.period || '';
}

/**
 * Shape a document for the app.
 *
 * Documents written before the schema refactor still have flat role/action/
 * result/learning and `period` at the top level. Those fields are no longer in
 * the schema, so Mongoose strips them on read — reading .lean() or the raw doc
 * is the only way to see them. `_doc` gives us the untouched document.
 */
function toDto(exp) {
  const raw = exp._doc || exp;
  const d = exp.description || {};
  const legacy = {
    role: raw.role || '',
    action: raw.action || '',
    result: raw.result || '',
    learning: raw.learning || '',
  };

  const role = d.role || legacy.role;
  const action = d.action || legacy.action;
  const result = d.result || legacy.result;
  const learning = d.learning || legacy.learning;

  return {
    id: exp._id.toString(),
    title: exp.title,
    category: exp.category,
    timeRange: exp.timeRange || raw.period || '',
    description: { role, action, result, learning },
    // Flat copies so an older client build keeps working during the transition.
    role,
    action,
    result,
    learning,
    tags: exp.tags || [],
  };
}

module.exports = router;