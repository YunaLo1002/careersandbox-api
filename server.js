require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const experienceRoutes = require('./routes/experiences');
const experienceChatRoutes = require('./routes/experienceChat');
const jobRoutes = require('./routes/jobs');
const resumeVersionRoutes = require('./routes/resumeVersions');
const interviewTranscribeRoutes = require('./routes/interviewTranscribe');

const app = express();

app.use(cors());
app.use(express.json());

// Routes. No /api prefix — the team guide and the Android client already use
// these paths, so changing them would mean a coordinated client update for no
// real benefit on an API-only service.
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/experiences', experienceRoutes);
app.use('/experience-chat', experienceChatRoutes);
app.use('/jobs', jobRoutes);
app.use('/resume-versions', resumeVersionRoutes);
app.use('/interview', interviewTranscribeRoutes);

// Health check
app.get('/', (req, res) => res.json({ status: 'ok' }));

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    // Cloud platforms inject their own PORT. The 0.0.0.0 host matters there:
    // the default binds to localhost only, so the platform's health check
    // cannot reach the process and the deploy is marked as failed.
    const port = process.env.PORT || 8000;
    app.listen(port, '0.0.0.0', () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => console.error('MongoDB connection error:', err));
