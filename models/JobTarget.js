const mongoose = require('mongoose');

// JobTarget — one application target (company + position).
//
// The middle layer of the three-tier structure the Android client already
// models in data/mock/ResumeHierarchy.kt:
//
//     ResumeMaster -> JobTarget -> ResumeVersion
//
// It exists because two things belong to the company rather than to any single
// resume PDF: the application status, and the JD the customization is based on.
// With versions hanging straight off the user, someone who generates three
// versions for one company has nowhere to record "interviewing", and the same
// JD gets stored three times.

const jobTargetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    company: { type: String, required: true, trim: true, maxlength: 200 },

    // What this JD emphasises — the basis for customization.
    jdKeywords: { type: [String], default: [] },

    // sourceId of an in-app job posting, when the target came from browsing.
    // Empty for targets the user typed in or pasted a JD for.
    jobId: { type: String, default: '' },

    // Full JD text, kept as a snapshot so the target stays readable after the
    // original posting changes or is taken down.
    jdSnapshot: { type: String, default: '', maxlength: 20000 },

    deadline: { type: Date, default: null },
        // Fit between the user's experiences and this JD, computed by the AI service
    // (B2 /jobs/{id}/fit). Cached here because the customize and detail screens
    // need it without another round trip; recomputed on demand or when
    // experiences change, so fitScoredAt says how fresh it is.
    matchScore: { type: Number, default: null },     // 0–100, null = not scored yet
    styleTag: { type: String, default: '' },
    fitScoredAt: { type: Date, default: null },
    requiredSkills: { type: [String], default: [] },
    salary: { type: String, default: '' },   // echoed by B2 from the crawled posting
  },
  { timestamps: true }
);

jobTargetSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('JobTarget', jobTargetSchema, 'job_targets');
