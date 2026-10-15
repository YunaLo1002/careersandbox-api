const express = require('express');
const router = express.Router();
const { Job } = require('../models/Job');


// Escape regex metacharacters so user input like "C++" or "(PM)" cannot break the query.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Crawled jobs come from several sources (104 / yourator / cake / taiwanjobs) with
// different shapes: salaryRaw is a string on 104 but an object on cake, taiwanjobs
// has category/subCategory instead of jobCategory, and so on. Normalise the fields
// the app reads so the client can declare each one with a single type.
function normalizeJob(j) {
  let salary = j.salaryRaw;
  if (salary && typeof salary === 'object') {
    const unit = salary.type === 'per_hour' ? '時薪' : '月薪';
    const range = [salary.min, salary.max].filter(Boolean).join('~');
    salary = range ? `${unit} ${range}` : null;
  }
  if (!salary && (j.salaryLow || j.salaryHigh)) {
    salary = `${j.salaryLow || ''}~${j.salaryHigh || ''}`;
  }
  return {
    _id: j._id,
    sourceId: j.sourceId,
    source: j.source,
    title: j.title || '',
    company: j.company || '',
    location: j.location || '',
    industry: j.industry || '',
    education: j.education || '',
    workExp: j.workExp || j.experience || '',
    salaryRaw: salary || null,
    description: j.description || '',
    conditionOther: j.conditionOther || '',
    requiredSkills: Array.isArray(j.requiredSkills) ? j.requiredSkills : [],
    jobCategory: Array.isArray(j.jobCategory)
      ? j.jobCategory
      : [j.category, j.subCategory].filter(Boolean),
    tags: Array.isArray(j.tags) ? j.tags : [],
    url: j.url || '',
  };
}

// 3. 搜尋職缺（依關鍵字）
// GET /jobs/search?q=資料分析&company=中信&skill=SQL
// q matches title, company and jobCategory (case-insensitive). Description is
// deliberately excluded: matching JD body text made nearly every query return
// the same few hundred postings.
router.get('/search', async (req, res) => {
  try {
    const { q, company, skill } = req.query;
    const conditions = {};

    if (q && q.trim()) {
      const re = new RegExp(escapeRegex(q.trim()), 'i');
      // Wrapped in $and: notExpired() also sets a top-level $or, and Mongoose's
      // where() replaces same-named keys instead of merging them.
      conditions.$and = [{
        $or: [
          { title: re },
          { company: re },
          { jobCategory: re },
        ],
      }];
    }
    if (company && company.trim()) {
      conditions.company = new RegExp(escapeRegex(company.trim()), 'i');
    }
    if (skill && skill.trim()) {
      conditions.requiredSkills = skill.trim();
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

    // Rank over the full match set, then page: slicing before ranking would
    // scramble the order between pages.
    const found = await Job.find(conditions).active().notExpired().lean();

    const kw = (q || '').trim().toLowerCase();
    const rank = (j) => {
      if (!kw) return 9;
      const has = (v) => (Array.isArray(v) ? v.join(' ') : v || '').toLowerCase().includes(kw);
      if (has(j.title)) return 0;
      if (has(j.company)) return 1;
      if (has(j.jobCategory)) return 2;
      return 3;
    };
    const ranked = found
      .map((j) => ({ j, r: rank(j) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.j);

    const total = ranked.length;
    const jobs = ranked.slice((page - 1) * limit, page * limit);

    res.json({
      data: jobs.map(normalizeJob),
      count: jobs.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /jobs/search', error);
    res.status(500).json({
      error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' },
    });
  }
});

// GET /jobs/random?n=10 — a random sample for the empty search state
router.get('/random', async (req, res) => {
  try {
    const n = Math.min(parseInt(req.query.n) || 10, 30);
    const jobs = await Job.aggregate([
      { $match: { noContent: { $ne: true }, gone: { $ne: true } } },
      { $sample: { size: n } },
    ]);
    res.json({ data: jobs.map(normalizeJob), count: jobs.length });
  } catch (error) {
    console.error('GET /jobs/random', error);
    res.status(500).json({
      error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' },
    });
  }
});

// Route order matters: Express matches top-down, so /search and /random must be
// declared before /:sourceId or they get captured as a sourceId.
// 1. 依 sourceId 取得單個職缺（給 AI 服務用）
// GET /api/jobs/:sourceId
router.get('/:sourceId', async (req, res) => {
  try {
    const job = await Job.findOne({ sourceId: req.params.sourceId })
      .active()
      .notExpired();

    if (!job) {
      return res.status(404).json({
        error: {
          code: 'not_found',
          message: 'Job not found'
        }
      });
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試'
      }
    });
  }
});

// 2. 查詢職缺列表（帶篩選條件）
// GET /api/jobs?page=1&limit=20&withSkills=true
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const withSkills = req.query.withSkills === 'true';

    let query = Job.find().active().notExpired();

    if (withSkills) {
      query = query.withSkills();
    }

    const total = await query.clone().countDocuments();
    const jobs = await query
      .skip(skip)
      .limit(limit)
      .sort({ crawledAt: -1 });

    res.json({
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: '服務暫時無法回應，請稍後再試'
      }
    });
  }
});

module.exports = router;