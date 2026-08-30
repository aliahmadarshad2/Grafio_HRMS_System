const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

function dayCount(start, end) {
  const s = new Date(start), e = new Date(end);
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

router.post('/policies', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { name, applies_to, annual_days, sick_days, casual_days, accrual_type } = req.body;
  if (!name || !applies_to) return res.status(400).json({ error: 'name and applies_to required' });
  const info = await db.run(`
    INSERT INTO leave_policies (name, applies_to, annual_days, sick_days, casual_days, accrual_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, applies_to, annual_days || 0, sick_days || 0, casual_days || 0, accrual_type || 'monthly']);
  res.status(201).json({ id: info.id });
});

router.get('/policies', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM leave_policies'));
});

router.put('/policies/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { name, applies_to, annual_days, sick_days, casual_days, accrual_type } = req.body;
  const fields = { name, applies_to, annual_days, sick_days, casual_days, accrual_type };
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { updates.push(`${k} = ?`); params.push(v); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE leave_policies SET ${updates.join(', ')} WHERE id = ?`, params);
  await logAudit(req.user.id, 'UPDATE_LEAVE_POLICY', 'leave_policies', req.params.id, req.body);
  res.json({ success: true });
});

router.delete('/policies/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM leave_policies WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_LEAVE_POLICY', 'leave_policies', req.params.id);
  res.json({ success: true });
});

router.post('/requests', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.user.employee_id]);
  if (emp.employment_type === 'Contractor') {
    return res.status(400).json({ error: 'Contractors are not eligible for standard leave (invoice-based engagement)' });
  }
  const { leave_type, start_date, end_date, reason, attachment } = req.body;
  if (!leave_type || !start_date || !end_date) return res.status(400).json({ error: 'leave_type, start_date, end_date required' });

  const days = dayCount(start_date, end_date);
  const balanceType = emp.employment_type === 'Intern' ? 'Flat' : leave_type;
  const balance = await db.get('SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type = ?',
    [req.user.employee_id, balanceType]);

  if (!balance || balance.balance < days) {
    return res.status(400).json({ error: `Insufficient leave balance. Available: ${balance ? balance.balance : 0}, Requested: ${days}` });
  }

  const info = await db.run(`
    INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, reason, attachment)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [req.user.employee_id, leave_type, start_date, end_date, days, reason || null, attachment || null]);

  res.status(201).json({ id: info.id, days, status: 'Pending' });
});

router.get('/requests', authenticate, async (req, res) => {
  let sql = `SELECT lr.*, e.full_name, e.employment_type FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id`;
  const params = [];
  if (req.user.role === 'Employee') {
    sql += ' WHERE lr.employee_id = ?'; params.push(req.user.employee_id);
  } else if (req.user.role === 'Manager') {
    sql += ' WHERE e.manager_id = ?'; params.push(req.user.employee_id);
  }
  sql += ' ORDER BY lr.created_at DESC';
  res.json(await db.all(sql, params));
});

router.put('/requests/:id', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { status } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const request = await db.get('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Not found' });

  await db.run('UPDATE leave_requests SET status = ?, approved_by = ? WHERE id = ?', [status, req.user.id, req.params.id]);

  if (status === 'Approved') {
    const emp = await db.get('SELECT * FROM employees WHERE id = ?', [request.employee_id]);
    const balanceType = emp.employment_type === 'Intern' ? 'Flat' : request.leave_type;
    await db.run('UPDATE leave_balances SET balance = balance - ? WHERE employee_id = ? AND leave_type = ?',
      [request.days, request.employee_id, balanceType]);
    await db.run(`INSERT INTO notifications (user_id, message, type) SELECT id, ?, 'leave_approval' FROM users WHERE employee_id = ?`,
      [`Your leave request (${request.start_date} to ${request.end_date}) was approved.`, request.employee_id]);
  } else {
    await db.run(`INSERT INTO notifications (user_id, message, type) SELECT id, ?, 'leave_approval' FROM users WHERE employee_id = ?`,
      [`Your leave request (${request.start_date} to ${request.end_date}) was rejected.`, request.employee_id]);
  }
  await logAudit(req.user.id, 'REVIEW_LEAVE_REQUEST', 'leave_requests', req.params.id, { status });
  res.json({ success: true });
});

router.get('/balances', authenticate, async (req, res) => {
  const employeeId = req.query.employee_id || req.user.employee_id;
  if (req.user.role === 'Employee' && employeeId != req.user.employee_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(await db.all('SELECT * FROM leave_balances WHERE employee_id = ?', [employeeId]));
});

router.get('/balances/:employee_id', authenticate, async (req, res) => {
  const employeeId = req.params.employee_id;
  if (req.user.role === 'Employee' && employeeId != req.user.employee_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(await db.all('SELECT * FROM leave_balances WHERE employee_id = ?', [employeeId]));
});

router.post('/accrue', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { leave_type, amount } = req.body;
  if (!leave_type || amount === undefined) return res.status(400).json({ error: 'leave_type and amount required' });

  const employees = await db.all(`SELECT id FROM employees WHERE employment_type IN ('Full-time','Part-time') AND status = 'Active'`);
  let count = 0;
  for (const e of employees) {
    const existing = await db.get('SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type = ?', [e.id, leave_type]);
    if (existing) {
      await db.run('UPDATE leave_balances SET balance = balance + ? WHERE id = ?', [amount, existing.id]);
    } else {
      await db.run('INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, ?, ?)', [e.id, leave_type, amount]);
    }
    count++;
  }
  await logAudit(req.user.id, 'ACCRUE_LEAVE', 'leave_balances', null, { leave_type, amount, affected: count });
  res.json({ success: true, employees_updated: count });
});

router.get('/reports', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { department_id } = req.query;
  let sql = `
    SELECT e.department_id, d.name as department_name, e.id as employee_id, e.full_name,
           lr.leave_type, COUNT(*) as request_count, SUM(CASE WHEN lr.status='Approved' THEN lr.days ELSE 0 END) as approved_days
    FROM leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
  `;
  const params = [];
  if (department_id) { sql += ' WHERE e.department_id = ?'; params.push(department_id); }
  sql += ' GROUP BY e.id, e.department_id, d.name, e.full_name, lr.leave_type ORDER BY d.name, e.full_name';
  res.json(await db.all(sql, params));
});

router.delete('/requests/:id', authenticate, async (req, res) => {
  const request = await db.get('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
  if (!request) return res.status(404).json({ error: 'Not found' });
  const isOwner = request.employee_id == req.user.employee_id;
  const isHR = ['HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isOwner && !isHR) return res.status(403).json({ error: 'Forbidden' });
  if (isOwner && request.status !== 'Pending') return res.status(400).json({ error: 'Only pending requests can be cancelled' });
  await db.run('DELETE FROM leave_requests WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
