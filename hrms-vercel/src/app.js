const express = require('express');
const cors = require('cors');
const db = require('./db/pg');
const seed = require('./db/seed');

const app = express();
app.use(cors());
app.use(express.json());

// Ensure schema + seed data exist before handling any request.
// Both calls are memoized so this only does real work once per warm instance.
let seeded = false;
app.use(async (req, res, next) => {
  try {
    await db.ensureSchema();
    if (!seeded) {
      seeded = true;
      await seed();
    }
    next();
  } catch (e) {
    console.error('Schema/seed init failed:', e);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/recruitment', require('./routes/recruitment'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/ess', require('./routes/ess'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/tasks', require('./routes/tasks'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
