const mongoose = require('mongoose');

// Sub-document for the languages section: { language: "英文", level: "TOEIC 875" }
const languageSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    level: { type: String, default: '' },
  },
  { _id: false }
);
// Sub-document for activities: { title, role, period, highlight }
const activitySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },      // 社團/活動名稱
    role: { type: String, default: '' },          // 擔任的職務
    period: { type: String, default: '' },        // 時間區間（如 "2024.9-2025.6"）
    highlight: { type: String, default: '' },     // 主要成就/亮點
  },
  // _id: true — the client needs a stable handle to edit or delete one entry.
  // Array index will not do: it shifts the moment an earlier entry is removed,
  // so a later edit would land on the wrong record.
  { _id: true }
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
    activities: { type: [activitySchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema, 'users');