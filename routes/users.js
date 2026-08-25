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
  };
}

// GET /users/me — profile of whoever owns the token
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ detail: 'User not found' });
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
      'interests', 'skillsHave', 'skillsWant', 'languages',
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
      return res.status(400).json({ detail: 'No valid fields to update' });
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) return res.status(404).json({ detail: 'User not found' });

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

module.exports = router;