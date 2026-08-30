const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();
const STANDARD_START = '09:00';
const STANDARD_HOURS = 8;

function timeDiffMinutes(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

router.post('/check-in', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile linked to this user' });
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const time = req.body.time || new Date().toISOString().slice(11, 16);
  const existing = await db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [req.user.employee_id, date]);
  if (existing && existing.check_in) return res.status(400).json({ error: 'Already checked in today' });

  const lateMinutes = Math.max(0, timeDiffMinutes(STANDARD_START, time));
  if (existing) {
    await db.run('UPDATE attendance SET check_in = ?, late_minutes = ? WHERE id = ?', [time, lateMinutes, existing.id]);
  } else {
    await db.run('INSERT INTO attendance (employee_id, date, check_in, late_minutes) VALUES (?, ?, ?, ?)',
      [req.user.employee_id, date, time, lateMinutes]);
  }
  res.json({ success: true, date, check_in: time, late_minutes: lateMinutes });
});

router.post('/check-out', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile linked to this user' });
  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const time = req.body.time || new Date().toISOString().slice(11, 16);
  const existing = await db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [req.user.employee_id, date]);
  if (!existing || !existing.check_in) return res.status(400).json({ error: 'No check-in found for today' });

  const minutesWorked = timeDiffMinutes(existing.check_in, time);
  const hours = Math.max(0, minutesWorked / 60);
  const overtimeMinutes = Math.max(0, minutesWorked - STANDARD_HOURS * 60);

  await db.run('UPDATE attendance SET check_out = ?, hours_worked = ?, overtime_minutes = ? WHERE id = ?',
    [time, Math.round(hours * 100) / 100, overtimeMinutes, existing.id]);
  res.json({ success: true, date, check_out: time, hours_worked: Math.round(hours * 100) / 100, overtime_minutes: overtimeMinutes });
});

router.get('/team', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = `SELECT a.*, e.full_name FROM attendance a JOIN employees e ON a.employee_id = e.id`;
  const where = [];
  const params = [];
  if (req.user.role === 'Manager') {
    where.push('e.manager_id = ?'); params.push(req.user.employee_id);
  }
  if (date_from) { where.push('a.date >= ?'); params.push(date_from); }
  if (date_to) { where.push('a.date <= ?'); params.push(date_to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY a.date DESC';
  res.json(await db.all(sql, params));
});

router.get('/me', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  res.json(await db.all('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC', [req.user.employee_id]));
});

router.post('/corrections', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const { date, requested_check_in, requested_check_out, reason } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const info = await db.run(`
    INSERT INTO attendance_corrections (employee_id, date, requested_check_in, requested_check_out, reason)
    VALUES (?, ?, ?, ?, ?)
  `, [req.user.employee_id, date, requested_check_in || null, requested_check_out || null, reason || null]);
  res.status(201).json({ id: info.id, status: 'Pending' });
});

router.get('/corrections', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  let sql = `SELECT c.*, e.full_name FROM attendance_corrections c JOIN employees e ON c.employee_id = e.id`;
  const params = [];
  if (req.user.role === 'Manager') {
    sql += ' WHERE e.manager_id = ?'; params.push(req.user.employee_id);
  }
  sql += ' ORDER BY c.created_at DESC';
  res.json(await db.all(sql, params));
});

router.put('/corrections/:id', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { status } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const correction = await db.get('SELECT * FROM attendance_corrections WHERE id = ?', [req.params.id]);
  if (!correction) return res.status(404).json({ error: 'Not found' });

  await db.run('UPDATE attendance_corrections SET status = ?, approved_by = ? WHERE id = ?', [status, req.user.id, req.params.id]);

  if (status === 'Approved') {
    const existing = await db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?',
      [correction.employee_id, correction.date]);
    if (existing) {
      await db.run('UPDATE attendance SET check_in = COALESCE(?, check_in), check_out = COALESCE(?, check_out), status = \'Corrected\' WHERE id = ?',
        [correction.requested_check_in, correction.requested_check_out, existing.id]);
    } else {
      await db.run('INSERT INTO attendance (employee_id, date, check_in, check_out, status) VALUES (?, ?, ?, ?, \'Corrected\')',
        [correction.employee_id, correction.date, correction.requested_check_in, correction.requested_check_out]);
    }
  }
  await logAudit(req.user.id, 'REVIEW_ATTENDANCE_CORRECTION', 'attendance_corrections', req.params.id, { status });
  res.json({ success: true });
});

router.post('/calendar', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { date, day_type, description } = req.body;
  if (!date || !day_type) return res.status(400).json({ error: 'date and day_type required' });
  await db.run(`
    INSERT INTO work_calendar (date, day_type, description) VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET day_type = excluded.day_type, description = excluded.description
  `, [date, day_type, description || null]);
  res.status(201).json({ success: true });
});

router.get('/calendar', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM work_calendar ORDER BY date'));
});

router.delete('/calendar/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM work_calendar WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
