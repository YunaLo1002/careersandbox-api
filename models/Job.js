const mongoose = require('mongoose');
const { Schema } = mongoose;

// Job postings crawled by the crawler team (4,125 docs).
// READ-ONLY from Node. mongo_ingest.py owns this collection and is the real
// schema authority. Never write to it from the API.
//
// strict:false — Python may add fields we do not know about. With strict:true
// those fields would be silently dropped when reading.
//
// No `default` values anywhere — a missing value is represented by the field
// being ABSENT, not by null or "". Defaults would collapse "we never had this
// data" and "this data is empty" into the same thing.

const jobSchema = new Schema(
  {
    source: String,
    sourceId: String,
    url: String,
    company: String,
    title: String,
    description: String,
    location: String,

    // Original salary string, e.g. "月薪 40,000~50,000元". THIS is what the UI
    // displays. See salaryLow/High below.
    salaryRaw: String,

    // Company benefits / work-type labels (年終獎金, 分紅配股...).
    // NOT skills — never use this field for skill matching.
    tags: [String],

    // 104 only (1,683)
    industry: String,
    snippet: String,
    appearDate: String,
    applyCount: Number,
    jobCategory: [String],
    workExp: String,
    conditionOther: String,
    // Only 1,010 docs have a non-empty value (24.5%). Skill matching reads this.
    requiredSkills: [String],

    // taiwanjobs only (964)
    category: String,
    subCategory: String,
    openings: Number,
    experience: String,
    workTime: String,
    // "20260901" — eight-digit string, not a Date. Left untouched so re-running
    // the Python importer stays idempotent. 155 docs say 「額滿為止」 instead.
    deadline: String,
    // Derived post-import. Use THIS for date comparisons; `deadline` is a
    // string and sorts incorrectly.
    deadlineDate: Date,

    // Do not compute with these yet. 76% of docs have no salaryType, so there
    // is no way to tell an hourly 200 from a monthly 40,000. Display salaryRaw.
    salaryLow: Number,
    salaryHigh: Number,
    salaryType: String,

    education: String,
    workType: String,
    seniority: String,
    companyEn: String,
    lastActiveAt: String,
    alsoOn: [{ source: String, url: String }],
    noContent: Boolean,
    gone: Boolean,
    crawledAt: Date,
    mergedAt: Date,
    descriptionFetchedAt: Date,
    updatedAt: Date,
  },
  { collection: 'jobs', strict: false, versionKey: false, timestamps: false }
);

// Exclude closed and delisted postings. Chain this on every user-facing query
// rather than repeating the filter in each route:  Job.find({...}).active()
jobSchema.query.active = function () {
  return this.where({ noContent: { $ne: true }, gone: { $ne: true } });
};

// Docs with no deadline are KEPT — most sources do not provide one, and
// absence is not expiry. This is what keeps the 155 「額滿為止」 postings visible.
jobSchema.query.notExpired = function (now = new Date()) {
  return this.where({
    $or: [{ deadlineDate: { $exists: false } }, { deadlineDate: { $gte: now } }],
  });
};

// Only postings carrying a structured skill list (1,010 of 4,125).
jobSchema.query.withSkills = function () {
  return this.where({ requiredSkills: { $exists: true, $ne: [] } });
};

const Job = mongoose.model('Job', jobSchema);
module.exports = { Job };
