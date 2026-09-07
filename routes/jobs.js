const express = require('express');
const router = express.Router();
const { Job } = require('../models/Job');


// 3. 搜尋職缺（依關鍵字）
// GET /api/jobs/search?q=Node.js&company=Google
router.get('/search', async (req, res) => {
  try {
    const { q, company, skill } = req.query;

    let query = Job.find().active().notExpired();

    if (q) {
      query = query.where({ 
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { description: { $regex: q, $options: 'i' } },
        ]
      });
    }

    if (company) {
      query = query.where({ company: { $regex: company, $options: 'i' } });
    }

    if (skill) {
      query = query.where({ requiredSkills: skill });
    }

    const jobs = await query.limit(50);

    res.json({
      data: jobs,
      count: jobs.length,
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

// Route order matters: Express matches top-down, so /search must be
// declared before /:sourceId or it gets captured as sourceId="search".
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