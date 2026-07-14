const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Account = require('../models/Account');
const jwt = require('jsonwebtoken');

const router = express.Router();

// register
router.post('/register', async (req, res) => {
  try {
    const {
      email, password, name,
      school, department, year,
      interests, skillsHave, skillsWant,
    } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ detail: 'Missing required fields' });
    }

    const existing = await Account.findOne({ email });
    if (existing) {
      return res.status(409).json({ detail: 'Email already registered' });
    }

    const user = await User.create({
      name,
      email,
      school: school || '',
      department: department || '',
      year: year || '',
      interests: Array.isArray(interests) ? interests : [],
      skillsHave: Array.isArray(skillsHave) ? skillsHave : [],
      skillsWant: Array.isArray(skillsWant) ? skillsWant : [],
    });

    const passwordHash = await bcrypt.hash(password, 10);
    await Account.create({ email, passwordHash, userId: user._id });

    // Auto-login after registration: sign a token just like /login does
    const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.status(201).json({
      token,
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ detail: 'Missing required fields' });
    }

    const account = await Account.findOne({ email });
    if (!account) {
      // Same message as wrong password — don't reveal which one failed
      return res.status(401).json({ detail: 'Email or password incorrect' });
    }

    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) {
      return res.status(401).json({ detail: 'Email or password incorrect' });
    }

    const user = await User.findById(account.userId);
    if (!user) {
      return res.status(500).json({ detail: 'User profile not found' });
    }

    // Sign a token that carries the userId, valid for 7 days
    const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    return res.status(200).json({
      token,
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;