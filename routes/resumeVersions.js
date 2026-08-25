const express = require('express');
const router = express.Router();
const ResumeVersion = require('../models/ResumeVersion');

// 1. 建立新版本（POST /resume-versions）
router.post('/', async (req, res) => {
  try {
    const version = new ResumeVersion(req.body);
    await version.save();
    res.status(201).json(version);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 2. 查詢使用者的所有版本（GET /resume-versions/user/:userId）
router.get('/user/:userId', async (req, res) => {
  try {
    const versions = await ResumeVersion.find({ userId: req.params.userId })
      .populate('userId')
      .sort({ createdAt: -1 });
    res.json(versions);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 3. 查詢特定職缺的版本（GET /resume-versions/user/:userId/job/:jobId）
router.get('/user/:userId/job/:jobId', async (req, res) => {
  try {
    const version = await ResumeVersion.findOne({
      userId: req.params.userId,
      jobId: req.params.jobId,
    }).populate('userId');
    if (!version) return res.status(404).json({ error: 'Resume version not found' });
    res.json(version);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 4. 更新版本（PUT /resume-versions/:versionId）
router.put('/:versionId', async (req, res) => {
  try {
    const version = await ResumeVersion.findByIdAndUpdate(
      req.params.versionId,
      req.body,
      { new: true, runValidators: true }
    );
    if (!version) return res.status(404).json({ error: 'Resume version not found' });
    res.json(version);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 5. 刪除版本（DELETE /resume-versions/:versionId）
router.delete('/:versionId', async (req, res) => {
  try {
    const version = await ResumeVersion.findByIdAndDelete(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Resume version not found' });
    res.json({ message: 'Resume version deleted', version });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;