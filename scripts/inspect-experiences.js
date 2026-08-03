/**
 * Survey the existing `experiences` collection before migrating.
 *
 * Do NOT design the migration from a single sample document. Run this first
 * and design against what is actually in the database.
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://..." node scripts/inspect-experiences.js
 *
 * Read-only. Safe to run against production.
 */

const mongoose = require('mongoose');
const { parsePeriod } = require('./lib/parsePeriod');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('Missing MONGODB_URI');
  process.exit(1);
}

function line(label) {
  console.log(`\n${'='.repeat(60)}\n${label}\n${'='.repeat(60)}`);
}

async function main() {
  await mongoose.connect(URI);
  const col = mongoose.connection.db.collection('experiences');

  const total = await col.countDocuments();
  line(`總筆數: ${total}`);
  if (total === 0) {
    console.log('collection 是空的，可以直接用新 schema，不需要 migration');
    return;
  }

  // ---- 1. Which fields actually exist, and how often -----------------------
  line('欄位出現率');
  const fieldCounts = await col
    .aggregate([
      { $project: { fields: { $objectToArray: '$$ROOT' } } },
      { $unwind: '$fields' },
      { $group: { _id: '$fields.k', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  for (const f of fieldCounts) {
    const pct = ((f.count / total) * 100).toFixed(0);
    console.log(`  ${f._id.padEnd(20)} ${String(f.count).padStart(5)} (${pct}%)`);
  }

  // ---- 2. category 的實際值域 ---------------------------------------------
  line('category 實際值域（決定 enum 要放哪些值）');
  const categories = await col
    .aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  for (const c of categories) {
    console.log(`  ${String(c._id).padEnd(20)} ${c.count}`);
  }

  // ---- 3. period 的格式分佈與可解析率 --------------------------------------
  line('period 格式分析（最關鍵的一項）');
  const periods = await col
    .find({}, { projection: { period: 1 } })
    .toArray();

  const ok = [];
  const failed = [];
  const formatSamples = new Map();

  for (const doc of periods) {
    const raw = doc.period;
    const parsed = parsePeriod(raw);
    if (parsed.startDate) ok.push({ raw, parsed });
    else failed.push(raw);

    // Bucket by shape: digits -> 9, letters -> A
    const shape = String(raw ?? '')
      .replace(/\d/g, '9')
      .replace(/[A-Za-z]/g, 'A');
    if (!formatSamples.has(shape)) formatSamples.set(shape, []);
    if (formatSamples.get(shape).length < 3) formatSamples.get(shape).push(raw);
  }

  console.log(`  可解析: ${ok.length} / ${total} (${((ok.length / total) * 100).toFixed(1)}%)`);
  console.log(`  無法解析: ${failed.length}`);

  console.log('\n  格式樣態:');
  const shapes = [...formatSamples.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );
  for (const [shape, samples] of shapes) {
    console.log(`    ${shape.padEnd(24)} 例: ${samples.map((s) => JSON.stringify(s)).join(', ')}`);
  }

  if (failed.length > 0) {
    console.log('\n  無法解析的樣本（最多 20 筆）:');
    for (const f of [...new Set(failed)].slice(0, 20)) {
      console.log(`    ${JSON.stringify(f)}`);
    }
  }

  console.log('\n  解析結果抽樣:');
  for (const s of ok.slice(0, 8)) {
    const e = s.parsed.endDate
      ? s.parsed.endDate.toISOString().slice(0, 7)
      : s.parsed.isCurrent
        ? '至今'
        : '(無結束)';
    console.log(
      `    ${JSON.stringify(s.raw).padEnd(24)} -> ${s.parsed.startDate.toISOString().slice(0, 7)} ~ ${e}`
    );
  }

  // ---- 4. 內容欄位的填寫率 -------------------------------------------------
  line('內容欄位填寫率（空字串算未填）');
  for (const f of ['title', 'role', 'action', 'result', 'learning']) {
    const filled = await col.countDocuments({
      [f]: { $exists: true, $nin: ['', null] },
    });
    const pct = ((filled / total) * 100).toFixed(0);
    console.log(`  ${f.padEnd(12)} ${String(filled).padStart(5)} / ${total} (${pct}%)`);
  }

  const emptyAll = await col.countDocuments({
    role: { $in: ['', null] },
    action: { $in: ['', null] },
    result: { $in: ['', null] },
  });
  console.log(`\n  role/action/result 全空: ${emptyAll} 筆`);
  console.log('  （這些筆無法生成履歷內容，要提示使用者補齊）');

  // ---- 5. tags 使用狀況 ----------------------------------------------------
  line('tags 使用狀況');
  const withTags = await col.countDocuments({ tags: { $exists: true, $ne: [] } });
  console.log(`  有 tags 的筆數: ${withTags} / ${total}`);
  const topTags = await col
    .aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ])
    .toArray();
  console.log('  前 30 個 tag（拿來當 skills 字典的起點）:');
  for (const t of topTags) console.log(`    ${String(t._id).padEnd(24)} ${t.count}`);

  // ---- 6. 缺少公司/組織名稱 -----------------------------------------------
  line('關鍵缺口檢查');
  const hasOrg = fieldCounts.find((f) =>
    ['organization', 'company', 'org'].includes(f._id)
  );
  if (!hasOrg) {
    console.log('  [!] 沒有任何公司/組織名稱欄位');
    console.log('      履歷一定要寫「在哪裡做的」，這個欄位非補不可');
    console.log('      需要 Alex 在 Android 新增經歷表單加一個輸入框');
  } else {
    console.log(`  OK 找到組織欄位: ${hasOrg._id}`);
  }

  // ---- 7. 每人筆數分佈 -----------------------------------------------------
  line('每位使用者的經歷筆數');
  const perUser = await col
    .aggregate([
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $group: { _id: null, users: { $sum: 1 }, avg: { $avg: '$count' }, max: { $max: '$count' } } },
    ])
    .toArray();
  if (perUser[0]) {
    console.log(`  使用者數: ${perUser[0].users}`);
    console.log(`  平均筆數: ${perUser[0].avg.toFixed(1)}`);
    console.log(`  最多筆數: ${perUser[0].max}`);
  }

  line('盤點完成');
  console.log('把以上輸出貼回去討論，再決定 migration 細節。');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
