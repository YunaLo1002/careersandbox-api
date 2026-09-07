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
    // The in-app job's sourceId. Not required: the handover document defines a
    // second path where the user pastes a JD from outside the app, and those
    // versions have only jdSnapshot. The route enforces that one of the two
    // is present.
    jobId: { type: String, default: '' },

    // Full JD text, stored as a snapshot for the pasted-JD path. Keeping a
    // copy here means the version stays readable even after the original
    // posting changes or is taken down.
    jdSnapshot: { type: String, default: '' },

    // User-facing name for this version, e.g. 「強調數據分析」.
    label: { type: String, default: '', trim: true, maxlength: 100 },

    items: [resumeItemSchema],                             // 客製後的經歷清單
  },
  { timestamps: true }
);

module.exports = mongoose.model('ResumeVersion', resumeVersionSchema, 'resume_versions');