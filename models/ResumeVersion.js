const mongoose = require('mongoose');

// Sub-document for resume items
const resumeItemSchema = new mongoose.Schema(
  {
    experienceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experience' },
    text: { type: String, default: '' },                  // 客製後的描述
    matchedKeywords: { type: [String], default: [] },     // 符合職缺的關鍵字
    highlighted: { type: [String], default: [] },         // 高亮部分
  },
  { _id: false }
);

const resumeVersionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jobId: { type: String, required: true },              // 對應職缺 ID
    jdSnapshot: { type: String, default: '' },     // ← 新增：外部貼上的 JD 快照
    items: [resumeItemSchema],                             // 客製後的經歷清單
  },
  { timestamps: true }
);

module.exports = mongoose.model('ResumeVersion', resumeVersionSchema, 'resume_versions');