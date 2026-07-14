const express = require('express');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /users/me — returns the profile of whoever owns the token
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    return res.status(200).json({
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      school: user.school,
      department: user.department,
      year: user.year,
      interests: user.interests,
      skillsHave: user.skillsHave,
      skillsWant: user.skillsWant,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;