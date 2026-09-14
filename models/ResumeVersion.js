const mongoose = require('mongoose');

// Sub-document for resume items
const resumeItemSchema = new mongoose.Schema(
  {
    experienceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experience' },
    text: { type: String, default: '' },                  // 客製後的描述
    matchedKeywords: { type: [String], default: [] },     // 符合職缺的關鍵字
    // The AI service returns a boolean here (CustomizedItemOut.highlighted):
    // whether this whole line should be emphasised, not which words.
    highlighted: { type: Boolean, default: false },
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

    // The JobTarget this version belongs to — the middle tier the Android
    // client already models. Optional so the two rows written before this
    // layer existed stay readable.
    targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobTarget', default: null, index: true },

    // User-facing name for this version, e.g. 「強調數據分析」.
    label: { type: String, default: '', trim: true, maxlength: 100 },

    // Must match SubmissionStatus in ResumeHierarchy.kt exactly; Kotlin enums
    // are fixed at compile time and fail to parse on an unknown value.
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED', 'INTERVIEWING', 'WAITING', 'REJECTED', 'OFFER'],
      default: 'DRAFT',
    },

    // Set the first time the version is marked SUBMITTED.
    submittedDate: { type: Date, default: null },

    // What this version emphasises differently.
    note: { type: String, default: '', maxlength: 500 },

    items: [resumeItemSchema],                             // 客製後的經歷清單
  },
  { timestamps: true }
);

module.exports = mongoose.model('ResumeVersion', resumeVersionSchema, 'resume_versions');