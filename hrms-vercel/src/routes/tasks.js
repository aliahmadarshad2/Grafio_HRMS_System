// Save this file as: src/routes/tasks.js
//
// Then in src/app.js, add this one line next to your other app.use(...) routes:
//   app.use('/api/tasks', require('./routes/tasks'));

const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

// Manager/HR assigns a task to an employee
router.post('/', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { employee_id, title, description, due_date } = req.body;
  if (!employee_id || !title) return res.status(400).json({ error: 'employee_id and title required' });
  const info = await db.run(`
    INSERT INTO tasks (employee_id, assigned_by, title, description, due_date)
    VALUES (?, ?, ?, ?, ?)
  `, [employee_id, req.user.employee_id || null, title, description || null, due_date || null]);
  await db.run(`INSERT INTO notifications (user_id, message, type) SELECT id, ?, 'task_assigned' FROM users WHERE employee_id = ?`,
    [`New task assigned: ${title}`, employee_id]);
  res.status(201).json({ id: info.id, status: 'Pending' });
});

// List tasks — Employee sees own, Manager sees their team's, HR/SystemAdmin see all
router.get('/', authenticate, async (req, res) => {
  let sql = `SELECT t.*, e.full_name as employee_name, a.full_name as assigned_by_name
             FROM tasks t JOIN employees e ON t.employee_id = e.id
             LEFT JOIN employees a ON t.assigned_by = a.id`;
  const params = [];
  if (req.user.role === 'Employee') {
    sql += ' WHERE t.employee_id = ?'; params.push(req.user.employee_id);
  } else if (req.user.role === 'Manager') {
    sql += ' WHERE e.manager_id = ? OR t.employee_id = ?'; params.push(req.user.employee_id, req.user.employee_id);
  }
  sql += ' ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC';
  res.json(await db.all(sql, params));
});

// Employee marks their own task's status; Manager/HR/SystemAdmin can update any field
router.put('/:id', authenticate, async (req, res) => {
  const task = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const isOwner = task.employee_id == req.user.employee_id;
  const isManagerHR = ['Manager', 'HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isOwner && !isManagerHR) return res.status(403).json({ error: 'Forbidden' });

  const { status, title, description, due_date } = req.body;
  const updates = [];
  const params = [];
  if (status !== undefined) {
    updates.push('status = ?'); params.push(status);
    updates.push('completed_at = ?'); params.push(status === 'Completed' ? new Date().toISOString() : null);
  }
  if (isManagerHR) {
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/:id', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// "Number of tasks done" — per-employee completed vs total, for a team dashboard
router.get('/summary', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  let sql = `
    SELECT e.id as employee_id, e.full_name,
      COUNT(*) as total_tasks,
      SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN t.status != 'Completed' THEN 1 ELSE 0 END) as open_tasks
    FROM tasks t JOIN employees e ON t.employee_id = e.id
  `;
  const params = [];
  if (req.user.role === 'Manager') { sql += ' WHERE e.manager_id = ?'; params.push(req.user.employee_id); }
  sql += ' GROUP BY e.id, e.full_name ORDER BY e.full_name';
  res.json(await db.all(sql, params));
});

module.exports = router;

