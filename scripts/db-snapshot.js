// scripts/db-snapshot.js
// Read-only overview of the database: every collection with its document count,
// indexes, the fields found in a sample of documents (types and how often each
// appears), and the newest few documents. Writes one UTF-8 Markdown file that can
// be opened in Notepad or attached to a chat.
//
// Usage (run from the project root so .env is found):
//   node scripts/db-snapshot.js                        # every collection
//   node scripts/db-snapshot.js --only jobs,courses    # just these collections
//   node scripts/db-snapshot.js --samples 5 --scan 300 --out snapshot.md
//   node scripts/db-snapshot.js --db otherDbName       # another database on the cluster
//
// Nothing is written to the database. Passwords, hashes, tokens, emails and phone
// numbers are replaced with "<redacted>" in the output, but the file can still hold
// personal data (names, experiences), so keep it out of git.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const SAMPLES = Number(arg('samples', 3)); // newest documents shown in full
const SCAN = Number(arg('scan', 200)); // random documents used to infer fields
const OUT = path.resolve(arg('out', 'db-snapshot.md'));
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DB_NAME = arg('db', '');

const SECRET_KEY = /pass(word)?|hash|salt|token|secret|otp|api[-_]?key|credential/i;
const CONTACT_KEY = /e-?mail|phone|mobile|^tel$|line_?id/i;
const MAX_STR = 160; // longer strings are cut in the sample documents
const MAX_ARR = 3; // longer arrays (e.g. embeddings) show only the first items
const MAX_DEPTH = 6;

const isSensitiveKey = (key) => Boolean(key) && (SECRET_KEY.test(key) || CONTACT_KEY.test(key));

function typeOf(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'Date';
  if (Buffer.isBuffer(v)) return 'Binary';
  if (typeof v === 'object' && v._bsontype) {
    return v._bsontype === 'ObjectID' ? 'ObjectId' : v._bsontype;
  }
  return typeof v; // string, number, boolean, object
}

function binaryLength(v) {
  if (Buffer.isBuffer(v)) return v.length;
  if (typeof v.length === 'function') return v.length();
  return v.buffer ? v.buffer.length : '?';
}

// Readable copy of a value: BSON types as text, long strings and arrays cut,
// sensitive keys masked.
function display(v, key = '', depth = 0) {
  if (isSensitiveKey(key) && v !== null && v !== undefined && v !== '') return '<redacted>';
  const t = typeOf(v);
  switch (t) {
    case 'ObjectId':
      return `ObjectId(${v.toHexString()})`;
    case 'Date':
      return Number.isNaN(v.getTime()) ? 'Date(invalid)' : `Date(${v.toISOString()})`;
    case 'Decimal128':
    case 'Long':
    case 'Int32':
    case 'Double':
      return `${t}(${v.toString()})`;
    case 'Binary':
      return `Binary(${binaryLength(v)} bytes)`;
    case 'string':
      return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}… (${v.length} chars)` : v;
    case 'array': {
      if (depth >= MAX_DEPTH) return `[${v.length} items]`;
      // Array elements inherit the field name, so a list of emails stays masked.
      const head = v.slice(0, MAX_ARR).map((x) => display(x, key, depth + 1));
      if (v.length > MAX_ARR) head.push(`… ${v.length - MAX_ARR} more (${v.length} items)`);
      return head;
    }
    case 'object': {
      if (depth >= MAX_DEPTH) return '{…}';
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = display(x, k, depth + 1);
      return out;
    }
    default:
      return v;
  }
}

// ---------------------------------------------------------------- field shapes

function note(stats, seen, p, key, v) {
  let s = stats.get(p);
  if (!s) {
    s = { types: new Map(), present: 0, example: undefined, key };
    stats.set(p, s);
  }
  const t = typeOf(v);
  s.types.set(t, (s.types.get(t) || 0) + 1);
  const scalar = !['null', 'undefined', 'object', 'array'].includes(t) && v !== '';
  if (s.example === undefined && scalar) s.example = v;
  seen.add(p);
}

// Collect every field path in one document ("a.b", "list[]", "list[].x").
function scanDoc(doc, stats) {
  const seen = new Set();
  const visit = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      note(stats, seen, p, k, v);
      if (depth >= MAX_DEPTH) continue;
      const t = typeOf(v);
      if (t === 'object') visit(v, p, depth + 1);
      else if (t === 'array') {
        for (const el of v.slice(0, 20)) {
          note(stats, seen, `${p}[]`, k, el);
          if (typeOf(el) === 'object') visit(el, `${p}[]`, depth + 1);
        }
      }
    }
  };
  visit(doc, '', 0);
  for (const p of seen) stats.get(p).present += 1;
}

function fieldTable(docs) {
  const stats = new Map();
  for (const d of docs) scanDoc(d, stats);
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const rows = ['| field | types | in docs | example |', '|---|---|---|---|'];
  for (const [p, s] of stats) {
    const types = [...s.types.entries()]
      .map(([t, n]) => (s.types.size > 1 ? `${t} (${n})` : t))
      .join(', ');
    let ex = '';
    if (s.example !== undefined) {
      const shown = display(s.example, s.key);
      ex = typeof shown === 'string' ? shown : JSON.stringify(shown);
      if (ex.length > 60) ex = `${ex.slice(0, 60)}…`;
    }
    rows.push(`| ${cell(p)} | ${cell(types)} | ${s.present}/${docs.length} | ${cell(ex)} |`);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------- per collection

function indexText(idx) {
  const opts = [idx.unique && 'unique', idx.sparse && 'sparse',
    idx.expireAfterSeconds !== undefined && `TTL ${idx.expireAfterSeconds}s`]
    .filter(Boolean).join(', ');
  return `- \`${idx.name}\`: \`${JSON.stringify(idx.key)}\`${opts ? ` (${opts})` : ''}`;
}

async function describeCollection(db, info) {
  const col = db.collection(info.name);
  const isView = info.type === 'view';
  const lines = [`## ${info.name}${isView ? ' (view)' : ''}`, ''];

  const count = isView ? await col.countDocuments({}) : await col.estimatedDocumentCount();
  lines.push(`Documents: ${count.toLocaleString('en-US')}`, '');
  if (count === 0) return { lines, count };

  if (!isView) {
    try {
      const idx = await col.indexes();
      lines.push('Indexes:', ...idx.map(indexText), '');
    } catch (e) {
      lines.push(`Indexes: (could not read: ${e.message})`, '');
    }
    try {
      // Atlas Search / Vector Search indexes are listed separately from normal ones.
      const search = await col.listSearchIndexes().toArray();
      if (search.length) {
        lines.push('Search indexes:',
          ...search.map((s) => `- \`${s.name}\` (${s.type || 'search'}, ${s.status || 'unknown status'})`), '');
      }
    } catch {
      // Not available on this cluster tier or driver version; skip quietly.
    }
  }

  let sample;
  try {
    sample = await col.aggregate([{ $sample: { size: SCAN } }]).toArray();
  } catch {
    sample = await col.find({}).limit(SCAN).toArray();
  }
  lines.push(`### Fields (from ${sample.length} random documents)`, '', fieldTable(sample), '');

  const newest = await col.find({}).sort({ _id: -1 }).limit(SAMPLES).toArray();
  lines.push(`### Newest ${newest.length} documents`, '', '```json',
    JSON.stringify(newest.map((d) => display(d)), null, 2), '```', '');
  return { lines, count };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Run this from the project root (where .env is).');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = DB_NAME ? mongoose.connection.client.db(DB_NAME) : mongoose.connection.db;
  console.log(`Connected. Database: ${db.databaseName}`);

  const header = [`# Database snapshot: ${db.databaseName}`, '',
    `Generated ${new Date().toISOString()} by scripts/db-snapshot.js (read-only).`,
    `Fields come from up to ${SCAN} random documents per collection; long strings and arrays are cut;`,
    'passwords, hashes, tokens, emails and phone numbers are shown as <redacted>.', ''];

  try {
    const { databases } = await mongoose.connection.client.db('admin').admin().listDatabases();
    header.push(`Other databases on this cluster: ${databases.map((d) => d.name).join(', ')}`, '');
  } catch {
    // The database user may not be allowed to list databases; not needed here.
  }

  const infos = (await db.listCollections({}, { nameOnly: false }).toArray())
    .filter((c) => !c.name.startsWith('system.'))
    .filter((c) => ONLY.length === 0 || ONLY.includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const overview = ['| collection | documents |', '|---|---|'];
  const sections = [];
  for (const info of infos) {
    process.stdout.write(`  ${info.name} ... `);
    try {
      const { lines, count } = await describeCollection(db, info);
      overview.push(`| ${info.name} | ${count.toLocaleString('en-US')} |`);
      sections.push(...lines);
      console.log(count);
    } catch (e) {
      overview.push(`| ${info.name} | error |`);
      sections.push(`## ${info.name}`, '', `Could not read: ${e.message}`, '');
      console.log(`error: ${e.message}`);
    }
  }

  const md = [...header, `## Collections (${infos.length})`, '', ...overview, '', ...sections].join('\n');
  fs.writeFileSync(OUT, md, 'utf8');
  console.log(`Wrote ${OUT}`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { display, fieldTable, typeOf, isSensitiveKey, describeCollection };