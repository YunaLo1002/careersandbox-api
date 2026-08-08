// scripts/ingest-jskg.js
// Ingest the data-science team's five JSONL files into MongoDB.
//
// Usage (run from the project root so .env is found):
//   node scripts/ingest-jskg.js --dry-run              # count only, no writes
//   node scripts/ingest-jskg.js                        # real ingest (default school: 國立中山大學)
//   node scripts/ingest-jskg.js --school "國立臺灣大學"  # ingest another school's courses (additive)
//
// Re-running is safe: every write is an upsert keyed on the file's primary key,
// so the same record never becomes two documents.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BATCH_SIZE = 1000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const schoolFlag = args.indexOf('--school');
const TARGET_SCHOOL = schoolFlag !== -1 && args[schoolFlag + 1]
  ? args[schoolFlag + 1].trim()
  : '國立中山大學';

// "YYYY/MM/DD" string → Date (UTC midnight); anything else → null
function toDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// One task per JSONL file: where it goes, its upsert key, and how to clean each row
const TASKS = [
  {
    file: 'skills.jsonl',
    collection: 'skills',
    key: (d) => ({ skill_id: d.skill_id }),
    clean: (d) => {
      delete d.source; // always "merged" — misleading, real origin lives in `sources`
      return d;
    },
  },
  {
    file: 'occupations.jsonl',
    collection: 'occupations',
    key: (d) => ({ occupation_id: d.occupation_id }),
    clean: (d) => {
      delete d.source;   // always "merged"
      delete d.onet_soc; // 0/66 populated — handover says safe to drop
      return d;
    },
  },
  {
    file: 'occupation_skills.jsonl',
    collection: 'occupation_skills',
    key: (d) => ({ occupation_id: d.occupation_id, skill_id: d.skill_id }),
    clean: (d) => {
      delete d.source; // always "merged"
      return d;
    },
  },
  {
    file: 'academic_jobs.jsonl',
    collection: 'academic_jobs',
    key: (d) => ({ source_job_id: d.source_job_id }),
    clean: (d) => {
      // Dates arrive as "YYYY/MM/DD" strings; store real Dates so deadline
      // filtering ("hide expired") becomes a plain query later
      d.post_date = toDate(d.post_date);
      d.deadline = toDate(d.deadline);
      return d;
    },
  },
  {
    file: 'courses.jsonl',
    collection: 'courses',
    collectSchools: true, // remember every school name seen, for the 0-match hint
    filter: (d) => typeof d.school === 'string' && d.school.trim() === TARGET_SCHOOL,
    key: (d) => ({ row_id: d.row_id }),
    clean: (d) => {
      d.school = String(d.school).trim();
      // course_id arrives as a mix of str and int — unify to string,
      // otherwise "1234" and 1234 would become two different documents
      d.course_id = String(d.course_id);
      if (d.grade !== undefined && d.grade !== null) d.grade = String(d.grade);
      return d;
    },
  },
];

async function ingestTask(db, task) {
  const filePath = path.join(DATA_DIR, task.file);
  if (!fs.existsSync(filePath)) {
    console.log(`[SKIP] data/${task.file} not found`);
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let batch = [];
  let scanned = 0;
  let kept = 0;
  let invalid = 0;
  const schools = task.collectSchools ? new Set() : null;

  const flush = async () => {
    if (batch.length === 0 || DRY_RUN) {
      batch = [];
      return;
    }
    await db.collection(task.collection).bulkWrite(batch, { ordered: false });
    batch = [];
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    scanned += 1;

    let doc;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      invalid += 1;
      continue;
    }

    if (schools && typeof doc.school === 'string') schools.add(doc.school.trim());
    if (task.filter && !task.filter(doc)) continue;

    doc = task.clean ? task.clean(doc) : doc;

    const key = task.key(doc);
    if (Object.values(key).some((v) => v === undefined || v === null)) {
      invalid += 1;
      continue;
    }

    kept += 1;
    batch.push({ replaceOne: { filter: key, replacement: doc, upsert: true } });
    if (batch.length >= BATCH_SIZE) await flush();
    if (kept % 20000 === 0) console.log(`  ...${task.collection}: ${kept} processed`);
  }
  await flush();

  console.log(
    `[${DRY_RUN ? 'DRY' : 'OK '}] ${task.collection}: scanned ${scanned}, ` +
    `${DRY_RUN ? 'would write' : 'written'} ${kept}, invalid ${invalid}`
  );

  // Zero courses matched → the school string is probably spelled differently.
  // Print every school name found so the right one can be copied.
  if (schools && kept === 0) {
    console.log(`  !! No courses matched school "${TARGET_SCHOOL}". Schools in the file:`);
    [...schools].sort().forEach((s) => console.log(`     - ${s}`));
  }
}

async function createIndexes(db) {
  await db.collection('skills').createIndex({ skill_id: 1 }, { unique: true });
  await db.collection('occupations').createIndex({ occupation_id: 1 }, { unique: true });
  await db.collection('occupation_skills').createIndex(
    { occupation_id: 1, skill_id: 1 },
    { unique: true }
  );
  await db.collection('occupation_skills').createIndex({ occupation_id: 1 });
  await db.collection('occupation_skills').createIndex({ skill_id: 1 });
  await db.collection('academic_jobs').createIndex({ source_job_id: 1 }, { unique: true });
  await db.collection('courses').createIndex({ row_id: 1 }, { unique: true });
  await db.collection('courses').createIndex({ school: 1, course_id: 1 }); // 改為非唯一,查詢用
  await db.collection('courses').createIndex({ department: 1 });
  await db.collection('courses').createIndex({ degree_level: 1 });
}

(async () => {
  console.log(`Mode: ${DRY_RUN ? 'dry-run (no writes)' : 'INGEST'}`);
  console.log(`Courses filter: school = "${TARGET_SCHOOL}"`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
  const db = mongoose.connection.db;

  for (const task of TASKS) {
    await ingestTask(db, task);
  }

  if (!DRY_RUN) {
    console.log('Creating indexes...');
    await createIndexes(db);
    console.log('Indexes done.');
  }

  await mongoose.disconnect();
  console.log('All done.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});