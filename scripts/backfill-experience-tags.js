// scripts/backfill-experience-tags.js
// Generate tags for experiences saved before utils/experienceTags.js existed.
//
// Usage (run from the project root so .env is found):
//   node scripts/backfill-experience-tags.js --dry-run   # print the tags, no writes
//   node scripts/backfill-experience-tags.js             # write tags
//   node scripts/backfill-experience-tags.js --all       # re-tag every experience,
//                                                        # replacing existing tags
//
// Re-running is safe: without --all, experiences that already have tags are skipped.

require('dotenv').config();

const mongoose = require('mongoose');
const Experience = require('../models/Experience');
const { tagExperience } = require('../utils/experienceTags');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');

async function main() {
  if (!process.env.MONGODB_URI || !process.env.OPENAI_API_KEY) {
    console.error('MONGODB_URI and OPENAI_API_KEY must be set. Run this from the project root (where .env is).');
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI);

  // 'tags.0' missing = no tags field or an empty array
  const filter = ALL ? {} : { 'tags.0': { $exists: false } };
  const docs = await Experience.find(filter).sort({ createdAt: 1 });
  console.log(`${docs.length} experiences${DRY_RUN ? ' (dry run: nothing is written)' : ''}`);

  let failed = 0;
  for (const exp of docs) {
    console.log(`\n${exp._id}  ${exp.title}`);
    try {
      const r = await tagExperience(exp, { write: !DRY_RUN });
      if (r.kept.length === 0) console.log('  (none)');
      for (const k of r.kept) console.log(`  + ${k.name}  「${k.quote}」`);
      for (const d of r.dropped) console.log(`  - ${d.name}  「${d.quote}」  ${d.why}`);
      if (!DRY_RUN && !r.written) console.log('  not written: edited while this ran');
    } catch (err) {
      failed += 1;
      console.log(`  failed: ${err.message}`);
    }
  }
  console.log(`\ndone, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
