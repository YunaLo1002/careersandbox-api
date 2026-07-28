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
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// POST /experiences — create one experience owned by the caller
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, category, period, role, action, result, learning, tags } = req.body ?? {};
    if (!title || !category) {
      return res.status(400).json({ detail: 'Missing required fields' });
    }
    const exp = await Experience.create({
      userId: req.userId, // from the token — never from the request body
      title,
      category,
      period: period || '',
      role: role || '',
      action: action || '',
      result: result || '',
      learning: learning || '',
      tags: Array.isArray(tags) ? tags : [],
    });
    return res.status(201).json(toDto(exp));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// DELETE /experiences/:id — delete one of the caller's own experiences
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // A malformed id would throw a CastError — treat it as "not found"
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ detail: 'Experience not found' });
    }
    const deleted = await Experience.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId, // ownership check — you can only delete your own
    });
    if (!deleted) {
      return res.status(404).json({ detail: 'Experience not found' });
    }
    return res.status(200).json({ id: deleted._id.toString(), deleted: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// Shape a MongoDB document into what the app expects.
// description is composed here so the list card needs no extra logic.
function toDto(exp) {
  return {
    id: exp._id.toString(),
    title: exp.title,
    category: exp.category,
    period: exp.period,
    role: exp.role,
    action: exp.action,
    result: exp.result,
    learning: exp.learning,
    description: [exp.action, exp.result].filter(Boolean).join(' '),
    tags: exp.tags,
  };
}

module.exports = router;