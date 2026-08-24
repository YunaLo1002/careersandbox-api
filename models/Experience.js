const mongoose = require('mongoose');

// Sub-document for description
const descriptionSchema = new mongoose.Schema(
  {
    role: { type: String, default: '' },           // 擔任的職務
    action: { type: String, default: '' },         // 做了什麼
    result: { type: String, default: '' },         // 量化成果
    learning: { type: String, default: '' },       // 學到什麼
  },
  { _id: false }
);

const experienceSchema = new mongoose.Schema(
  {
    // Owner — the one-to-many link back to users
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    category: { type: String, required: true }, // 學業 / 工作 / 社團 / 競賽 / 其他
    timeRange: { type: String, default: '' },      // e.g. "2024.09 - 2025.06"
    description: descriptionSchema,                 // ← 包含 role/action/result/learning
    tags: { type: [String], default: [] },      // future: AI-generated
  },
  { timestamps: true }
);

module.exports = mongoose.model('Experience', experienceSchema, 'experiences');