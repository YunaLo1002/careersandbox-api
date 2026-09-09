const mongoose = require('mongoose');
const { Schema } = mongoose;

// Two record kinds share this collection, split by `type`:
//   article   (164) - copyrighted career columns, retrieval only
//   job_skill (112) - occupation -> skill percentage tables
// READ-ONLY from Node. The Python importer owns this collection.

const KNOWLEDGE_TYPE = Object.freeze({
  ARTICLE: 'article',
  JOB_SKILL: 'job_skill',
});

const careerKnowledgeSchema = new Schema(
  {
    type: { type: String, enum: Object.values(KNOWLEDGE_TYPE) },
    source: String,
    sourceId: String,
    tags: [String],

    // COPYRIGHT BOUNDARY. Third-party text, some licensed reprints.
    // Usable for embedding and retrieval; never return it verbatim.
    // select:false keeps it out of every query unless a caller writes
    // .select('+text'), so a stray find().lean() cannot leak it.
    text: { type: String, select: false },

    title: String,
    url: String,
    publishedAt: Date,

    occupation: String,
    section: String,
    stats: { type: Schema.Types.Mixed },
    jobCount: Number,
  },
  { // Crawler-side raw entries. The vector knowledge base lives in
// `career_knowledge` and has a different shape (kb_xxx ids, embedding
// field); only the model team's ingest_atlas.py writes there.
    collection: 'career_knowledge_raw', strict: false, versionKey: false, timestamps: false }
);

careerKnowledgeSchema.query.articles = function () {
  return this.where({ type: KNOWLEDGE_TYPE.ARTICLE });
};

careerKnowledgeSchema.query.jobSkills = function () {
  return this.where({ type: KNOWLEDGE_TYPE.JOB_SKILL });
};

careerKnowledgeSchema.statics.getSkillProfile = async function (occupation) {
  const doc = await this.findOne({ type: KNOWLEDGE_TYPE.JOB_SKILL, occupation }).lean();
  if (!doc || !doc.stats) return null;
  const skills = Object.entries(doc.stats)
    .map(([name, pct]) => ({ name, pct }))
    .sort((a, b) => b.pct - a.pct);
  return { occupation: doc.occupation, jobCount: doc.jobCount, skills };
};

careerKnowledgeSchema.methods.toCitation = function () {
  return { title: this.title, url: this.url, source: this.source, publishedAt: this.publishedAt };
};

const CareerKnowledge = mongoose.model('CareerKnowledge', careerKnowledgeSchema);
module.exports = { CareerKnowledge, KNOWLEDGE_TYPE };
