const mongoose = require('mongoose');

const experienceSchema = new mongoose.Schema(
  {
    // Owner — the one-to-many link back to users
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    category: { type: String, required: true }, // 學業 / 工作 / 社團 / 競賽 / 其他
    period: { type: String, default: '' },      // e.g. "2024.09 - 2025.06"
    role: { type: String, default: '' },
    action: { type: String, default: '' },      // what they did
    result: { type: String, default: '' },      // measurable outcome
    learning: { type: String, default: '' },    // takeaway
    tags: { type: [String], default: [] },      // future: AI-generated
  },
  { timestamps: true }
);

module.exports = mongoose.model('Experience', experienceSchema, 'experiences');