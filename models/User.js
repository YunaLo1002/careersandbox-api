const mongoose = require('mongoose');

// Sub-document for the languages section: { language: "英文", level: "TOEIC 875" }
const languageSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    level: { type: String, default: '' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    school: { type: String, default: '' },
    department: { type: String, default: '' },
    year: { type: String, default: '' },
    phone: { type: String, default: '' },
    bio: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' },
    portfolio: { type: String, default: '' },
    interests: { type: [String], default: [] },
    skillsHave: { type: [String], default: [] },
    skillsWant: { type: [String], default: [] },
    languages: { type: [languageSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema, 'users');