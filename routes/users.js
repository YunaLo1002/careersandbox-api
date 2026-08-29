const express = require('express');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Shape a user document into what the app expects
function toDto(user) {
  return {
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
    school: user.school,
    department: user.department,
    year: user.year,
    phone: user.phone,
    bio: user.bio,
    linkedin: user.linkedin,
    github: user.github,
    portfolio: user.portfolio,
    interests: user.interests,
    skillsHave: user.skillsHave,
    skillsWant: user.skillsWant,
    languages: (user.languages || []).map((l) => ({
      language: l.language,
      level: l.level,
    })),
    activities: (user.activities || []).map((a) => ({
      id: a._id.toString(),
      title: a.title,
      role: a.role,
      period: a.period,
      highlight: a.highlight,
    })),
  };
}

// GET /users/me — profile of whoever owns the token
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: { code: 'not_found', message: '找不到使用者資料' } });
    return res.status(200).json(toDto(user));
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

// PATCH /users/me — update the caller's own profile
router.patch('/me', requireAuth, async (req, res) => {
  try {
    // Whitelist: email is deliberately NOT here (it is the login key)
    const allowed = [
      'name', 'school', 'department', 'year',
      'phone', 'bio', 'linkedin', 'github', 'portfolio',
      'interests', 'skillsHave', 'skillsWant', 'languages', 'activities',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }

    // name is required by the schema — ignore attempts to blank it
    if (typeof updates.name === 'string' && updates.name.trim() === '') {
      delete updates.name;
    }

    // Plain-array fields must actually be arrays
    for (const key of ['interests', 'skillsHave', 'skillsWant']) {
      if (updates[key] !== undefined && !Array.isArray(updates[key])) delete updates[key];
    }

    // languages must be an array of { language, level } — sanitize each entry
    if (updates.languages !== undefined) {
      if (!Array.isArray(updates.languages)) {
        delete updates.languages;
      } else {
        updates.languages = updates.languages
          .filter((l) => l && typeof l.language === 'string' && l.language.trim() !== '')
          .map((l) => ({
            language: l.language.trim(),
            level: typeof l.level === 'string' ? l.level.trim() : '',
          }));
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(422).json({ error: { code: 'validation_error', message: '沒有可更新的欄位' } });
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) return res.status(404).json({ error: { code: 'not_found', message: '找不到使用者資料' } });

    return res.status(200).json(toDto(user));
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


/* --------------------------------------------------------------------------
 * activities — 「06 社團與競賽經歷」 on the profile screen
 *
 * Addressed by _id rather than array index: an index shifts as soon as any
 * earlier entry is deleted, which would make a later edit hit the wrong row.
 * -------------------------------------------------------------------------- */

// POST /users/me/activities — append one entry
router.post('/me/activities', requireAuth, async (req, res) => {
  try {
    const { title, role, period, highlight } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(422).json({ error: { code: 'validation_error', message: 'title 為必填' } });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        $push: {
          activities: {
            title: String(title).trim(),
            role: role || '',
            // Free text: both "2024.09 - 2025.03" and "2024.10" are valid.
            period: period || '',
            highlight: highlight || '',
          },
        },
      },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ error: { code: 'not_found', message: '找不到使用者資料' } });

    return res.status(201).json(toDto(user));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' } });
  }
});

// PATCH /users/me/activities/:activityId
router.patch('/me/activities/:activityId', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: { code: 'not_found', message: '找不到使用者資料' } });

    const activity = user.activities.id(req.params.activityId);
    if (!activity) return res.status(404).json({ error: { code: 'not_found', message: '找不到這筆社團經歷' } });

    for (const key of ['title', 'role', 'period', 'highlight']) {
      if (req.body?.[key] !== undefined) activity[key] = req.body[key];
    }

    await user.save();
    return res.status(200).json(toDto(user));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' } });
  }
});

// DELETE /users/me/activities/:activityId
router.delete('/me/activities/:activityId', requireAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $pull: { activities: { _id: req.params.activityId } } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: { code: 'not_found', message: '找不到使用者資料' } });

    return res.status(200).json(toDto(user));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' } });
  }
});

module.exports = router;