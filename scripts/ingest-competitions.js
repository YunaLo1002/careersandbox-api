// scripts/ingest-competitions.js
// Ingest competitions_with_skills.jsonl into MongoDB's `competitions` collection.
//
// Source: 模型組（skill-tagged superset of the original competitions.jsonl handover）.
// 65 rows, same sourceId values as the original file, every original field kept,
// plus `skills` (list of name_zh aligned to the skills vocabulary — empty for
// design/architecture competitions that don't map to a skill).
//
// Usage (run from the project root so .env is found):
//   node scripts/ingest-competitions.js --dry-run   # count only, no writes
//   node scripts/ingest-competitions.js             # real ingest
//   node scripts/ingest-competitions.js data/<other>.jsonl [--dry-run]   # use another file
//
// Re-running is safe: every write is an upsert keyed on sourceId (never `id` —
// "c1".."c65" are display order and will shift on a re-crawl).

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

const COLLECTION = 'competitions';
const BATCH_SIZE = 1000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
// Optional first non-flag argument = path to the JSONL (relative to the cwd).
const fileArg = args.find((a) => !a.startsWith('--'));
const FILE = fileArg
  ? path.resolve(fileArg)
  : path.join(__dirname, '..', 'data', 'competitions_with_skills.jsonl');

// Duplicates confirmed by the crawler team (2026-10-26). Never import these,
// and remove them if an earlier run already wrote them.
//   byuey863l6pvdg9deg = "資訊應用服務創新競賽" (c27), duplicate of khx6k1xzrfn3knkw1z (c25)
const EXCLUDE = new Set(['byuey863l6pvdg9deg']);

// bhuntr "file-presign" cover URLs expire, so the crawler team handed over the
// images themselves. They live in public/covers/ as "<id>_<sourceId>.<ext>"
// (e.g. c6_pm85ocr2n6cplopfn0.jpg). When a file exists for a row, store the
// relative path "/covers/<file>" instead of the expiring URL; the API turns it
// into an absolute URL per request (the host differs per machine/device).
const COVERS_DIR = path.join(__dirname, '..', 'public', 'covers');

function loadLocalCovers() {
  const map = new Map(); // sourceId -> filename
  if (!fs.existsSync(COVERS_DIR)) return map;
  for (const f of fs.readdirSync(COVERS_DIR)) {
    const m = f.match(/^c\d+_(.+)\.(jpe?g|png|webp|gif)$/i);
    if (m) map.set(m[1], f);
  }
  return map;
}

// "YYYY/MM/DD" string → Date (UTC midnight); anything else → null.
// Kept for completeness; this file's `deadline` is this shape but `deadlineIso`
// (a real ISO timestamp with offset) is what expiry checks and sorting should use.
function toDeadlineDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function clean(d) {
  // deadlineIso is already a proper ISO string with offset — store it as a real
  // Date too, so "未過期" queries can use a plain $gte instead of string compare.
  if (d.deadlineIso) d.deadlineIsoDate = new Date(d.deadlineIso);
  if (d.deadline) d.deadlineDate = toDeadlineDate(d.deadline);
  // skills must survive untouched — it's what /skills/reinforce matches against.
  if (!Array.isArray(d.skills)) d.skills = [];
  return d;
}

async function run() {
  if (!fs.existsSync(FILE)) {
    console.error(`File not found: ${FILE}`);
    console.error('Put competitions_with_skills.jsonl in the data/ folder first.');
    process.exit(1);
  }

  console.log(`Mode: ${DRY_RUN ? 'dry-run (no writes)' : 'INGEST'}`);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
  const db = mongoose.connection.db;

  const covers = loadLocalCovers();
  console.log(`Local cover images found: ${covers.size} (public/covers)`);

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let batch = [];
  let scanned = 0;
  let kept = 0;
  let invalid = 0;
  let withSkills = 0;
  let skipped = 0;
  let coversLocal = 0;

  const flush = async () => {
    if (batch.length === 0 || DRY_RUN) {
      batch = [];
      return;
    }
    await db.collection(COLLECTION).bulkWrite(batch, { ordered: false });
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

    if (!doc.sourceId) {
      invalid += 1;
      continue;
    }
    if (EXCLUDE.has(doc.sourceId)) {
      skipped += 1;
      continue;
    }

    doc = clean(doc);
    const localCover = covers.get(doc.sourceId);
    if (localCover) {
      doc.coverImageUrl = `/covers/${localCover}`;
      coversLocal += 1;
    }
    if (doc.skills.length > 0) withSkills += 1;

    kept += 1;
    batch.push({
      replaceOne: { filter: { sourceId: doc.sourceId }, replacement: doc, upsert: true },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    `[${DRY_RUN ? 'DRY' : 'OK '}] ${COLLECTION}: scanned ${scanned}, ` +
    `${DRY_RUN ? 'would write' : 'written'} ${kept}, invalid ${invalid}, ` +
    `skipped ${skipped}, with skills ${withSkills}, local covers ${coversLocal}`
  );

  // An earlier run may already have written an excluded row; upsert never deletes.
  const excluded = [...EXCLUDE];
  const stale = await db.collection(COLLECTION).countDocuments({ sourceId: { $in: excluded } });
  if (DRY_RUN) {
    console.log(`  would delete ${stale} existing excluded row(s)`);
  } else if (stale > 0) {
    const r = await db.collection(COLLECTION).deleteMany({ sourceId: { $in: excluded } });
    console.log(`  deleted ${r.deletedCount} existing excluded row(s)`);
  }

  if (!DRY_RUN) {
    console.log('Creating index...');
    await db.collection(COLLECTION).createIndex({ sourceId: 1 }, { unique: true });
    await db.collection(COLLECTION).createIndex({ category: 1 });
    await db.collection(COLLECTION).createIndex({ deadlineIsoDate: 1 });
    console.log('Index done.');
  }

  await mongoose.disconnect();
  console.log('All done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});