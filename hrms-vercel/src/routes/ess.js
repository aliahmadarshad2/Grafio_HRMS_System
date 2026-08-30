const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const eid = req.user.employee_id;
  const attendance = await db.all('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC LIMIT 5', [eid]);
  const leaveBalances = await db.all('SELECT * FROM leave_balances WHERE employee_id = ?', [eid]);
  const projects = await db.all(`
    SELECT p.name, pa.role_on_project FROM project_assignments pa JOIN projects p ON pa.project_id = p.id WHERE pa.employee_id = ?
  `, [eid]);
  const pendingLeave = await db.get(`SELECT COUNT(*) as c FROM leave_requests WHERE employee_id = ? AND status = 'Pending'`, [eid]);
  res.json({ attendance, leaveBalances, projects, pending_leave_requests: Number(pendingLeave.c) });
});

router.post('/tickets', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const { subject, description } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject required' });
  const info = await db.run('INSERT INTO tickets (employee_id, subject, description) VALUES (?, ?, ?)',
    [req.user.employee_id, subject, description || null]);
  res.status(201).json({ id: info.id, status: 'Open' });
});

router.get('/tickets', authenticate, async (req, res) => {
  if (['HRAdmin', 'SystemAdmin'].includes(req.user.role)) {
    return res.json(await db.all(`
      SELECT t.*, e.full_name FROM tickets t JOIN employees e ON t.employee_id = e.id ORDER BY t.created_at DESC
    `));
  }
  res.json(await db.all('SELECT * FROM tickets WHERE employee_id = ? ORDER BY created_at DESC', [req.user.employee_id]));
});

router.delete('/tickets/:id', authenticate, async (req, res) => {
  const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  const isOwner = ticket.employee_id == req.user.employee_id;
  const isHR = ['HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isOwner && !isHR) return res.status(403).json({ error: 'Forbidden' });
  if (isOwner && !isHR && ticket.status !== 'Open') return res.status(400).json({ error: 'Only open tickets can be withdrawn' });
  await db.run('DELETE FROM tickets WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.put('/tickets/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { status, resolution } = req.body;
  await db.run('UPDATE tickets SET status = COALESCE(?, status), resolution = COALESCE(?, resolution) WHERE id = ?',
    [status || null, resolution || null, req.params.id]);
  await logAudit(req.user.id, 'RESOLVE_TICKET', 'tickets', req.params.id, { status });
  res.json({ success: true });
});

router.get('/policies', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM policies ORDER BY updated_at DESC'));
});

router.post('/policies', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { title, content } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = await db.run('INSERT INTO policies (title, content) VALUES (?, ?)', [title, content || null]);
  res.status(201).json({ id: info.id });
});

router.put('/policies/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { title, content } = req.body;
  const updates = [];
  const params = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  updates.push('updated_at = NOW()');
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE policies SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/policies/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM policies WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/announcements', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { title, content } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = await db.run('INSERT INTO announcements (title, content, posted_by) VALUES (?, ?, ?)',
    [title, content || null, req.user.id]);
  res.status(201).json({ id: info.id });
});

router.get('/announcements', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM announcements ORDER BY created_at DESC'));
});

router.put('/announcements/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { title, content } = req.body;
  const updates = [];
  const params = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/announcements/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.get('/notifications', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]));
});

router.put('/notifications/:id/read', authenticate, async (req, res) => {
  await db.run('UPDATE notifications SET is_read = true WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

router.post('/notifications/generate-reminders', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  let count = 0;
  const pendingLeave = await db.all(`
    SELECT lr.id, e.manager_id, e.full_name FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id
    WHERE lr.status = 'Pending'
  `);
  for (const p of pendingLeave) {
    if (!p.manager_id) continue;
    await db.run(`
      INSERT INTO notifications (user_id, message, type)
      SELECT id, ?, 'pending_approval' FROM users WHERE employee_id = ?
    `, [`Leave request from ${p.full_name} is pending your approval.`, p.manager_id]);
    count++;
  }
  await logAudit(req.user.id, 'GENERATE_REMINDERS', 'notifications', null, { count });
  res.json({ generated: count });
});

module.exports = router;
