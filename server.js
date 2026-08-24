require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const app = express();
const experienceRoutes = require('./routes/experiences');
const jobRoutes = require('./routes/jobs');
const resumeVersionRoutes = require('./routes/resumeVersions');


app.use(cors());
app.use(express.json()); // parse JSON request bodies
app.use('/experiences', experienceRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/resume-versions', resumeVersionRoutes);

// Health check: open http://localhost:8000 in a browser to verify
app.get('/', (req, res) => res.json({ status: 'ok' }));

app.use('/users', userRoutes);
app.use('/auth', authRoutes);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT, () => {
      console.log(`Server running on http://localhost:${process.env.PORT}`);
    });
  })
  .catch((err) => console.error('MongoDB connection error:', err));