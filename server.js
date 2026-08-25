require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const app = express();
const experienceRoutes = require('./routes/experiences');
<<<<<<< HEAD
const experienceChatRoutes = require('./routes/experienceChat');
=======
const jobRoutes = require('./routes/jobs');
const resumeVersionRoutes = require('./routes/resumeVersions');
>>>>>>> origin/main


app.use(cors());
app.use(express.json()); // parse JSON request bodies

// 所有路由（暫時都不驗證）
app.use('/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/experiences', experienceRoutes);
app.use('/api/resume-versions', resumeVersionRoutes);
app.use('/users', userRoutes);

// Health check
app.get('/', (req, res) => res.json({ status: 'ok' }));

<<<<<<< HEAD
app.use('/users', userRoutes);
app.use('/auth', authRoutes);
app.use('/experience-chat', experienceChatRoutes);
=======
>>>>>>> origin/main

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT, () => {
      console.log(`Server running on http://localhost:${process.env.PORT}`);
    });
  })
  .catch((err) => console.error('MongoDB connection error:', err));