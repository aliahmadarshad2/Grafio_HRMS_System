const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.post('/clients', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { name, contact_info } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = await db.run('INSERT INTO clients (name, contact_info) VALUES (?, ?)', [name, contact_info || null]);
  res.status(201).json({ id: info.id, name });
});

router.get('/clients', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM clients'));
});

router.put('/clients/:id', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { name, contact_info } = req.body;
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (contact_info !== undefined) { updates.push('contact_info = ?'); params.push(contact_info); }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/clients/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM clients WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_CLIENT', 'clients', req.params.id);
  res.json({ success: true });
});

router.post('/', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { name, client_id, donor, location, funding_source, start_date, end_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = await db.run(`
    INSERT INTO projects (name, client_id, donor, location, funding_source, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [name, client_id || null, donor || null, location || null, funding_source || null, start_date || null, end_date || null]);
  await logAudit(req.user.id, 'CREATE_PROJECT', 'projects', info.id, { name });
  res.status(201).json({ id: info.id, name });
});

router.get('/', authenticate, async (req, res) => {
  const rows = await db.all(`
    SELECT p.*, c.name as client_name FROM projects p LEFT JOIN clients c ON p.client_id = c.id ORDER BY p.start_date DESC
  `);
  res.json(rows);
});

router.put('/:id', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const fields = ['name', 'client_id', 'donor', 'location', 'funding_source', 'start_date', 'end_date', 'status'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
  await logAudit(req.user.id, 'UPDATE_PROJECT', 'projects', req.params.id, req.body);
  res.json({ success: true });
});

router.delete('/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_PROJECT', 'projects', req.params.id);
  res.json({ success: true });
});

router.post('/:id/assignments', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { employee_id, role_on_project, start_date, end_date, is_volunteer } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
  const info = await db.run(`
    INSERT INTO project_assignments (project_id, employee_id, role_on_project, start_date, end_date, is_volunteer)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [req.params.id, employee_id, role_on_project || null, start_date || null, end_date || null, !!is_volunteer]);
  await db.run(`INSERT INTO notifications (user_id, message, type) SELECT id, ?, 'project_assignment' FROM users WHERE employee_id = ?`,
    [`You have been assigned to a new project (ID ${req.params.id}).`, employee_id]);
  res.status(201).json({ id: info.id });
});

router.get('/:id/assignments', authenticate, async (req, res) => {
  res.json(await db.all(`
    SELECT pa.*, e.full_name, e.employment_type FROM project_assignments pa
    JOIN employees e ON pa.employee_id = e.id WHERE pa.project_id = ?
  `, [req.params.id]));
});

router.delete('/:id/assignments/:assignmentId', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  await db.run('DELETE FROM project_assignments WHERE id = ? AND project_id = ?', [req.params.assignmentId, req.params.id]);
  res.json({ success: true });
});

router.get('/my-assignments', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  res.json(await db.all(`
    SELECT pa.*, p.name as project_name, p.donor, p.location FROM project_assignments pa
    JOIN projects p ON pa.project_id = p.id WHERE pa.employee_id = ?
  `, [req.user.employee_id]));
});

router.post('/:id/time-logs', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const { date, hours, billable, notes } = req.body;
  if (!date || hours === undefined) return res.status(400).json({ error: 'date and hours required' });
  const info = await db.run(`
    INSERT INTO time_logs (employee_id, project_id, date, hours, billable, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [req.user.employee_id, req.params.id, date, hours, billable === false ? false : true, notes || null]);
  res.status(201).json({ id: info.id });
});

router.get('/:id/time-logs', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager', 'FinanceOfficer'), async (req, res) => {
  res.json(await db.all(`
    SELECT tl.*, e.full_name FROM time_logs tl JOIN employees e ON tl.employee_id = e.id WHERE tl.project_id = ?
  `, [req.params.id]));
});

// Employee's own logged time across all projects (for editing/deleting their entries)
router.get('/my-time-logs', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  res.json(await db.all(`
    SELECT tl.*, p.name as project_name FROM time_logs tl JOIN projects p ON tl.project_id = p.id
    WHERE tl.employee_id = ? ORDER BY tl.date DESC
  `, [req.user.employee_id]));
});

router.put('/time-logs/:logId', authenticate, async (req, res) => {
  const log = await db.get('SELECT * FROM time_logs WHERE id = ?', [req.params.logId]);
  if (!log) return res.status(404).json({ error: 'Not found' });
  const isOwner = log.employee_id == req.user.employee_id;
  const isHR = ['HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isOwner && !isHR) return res.status(403).json({ error: 'Forbidden' });
  const { date, hours, billable, notes } = req.body;
  const updates = [];
  const params = [];
  if (date !== undefined) { updates.push('date = ?'); params.push(date); }
  if (hours !== undefined) { updates.push('hours = ?'); params.push(hours); }
  if (billable !== undefined) { updates.push('billable = ?'); params.push(billable); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.logId);
  await db.run(`UPDATE time_logs SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/time-logs/:logId', authenticate, async (req, res) => {
  const log = await db.get('SELECT * FROM time_logs WHERE id = ?', [req.params.logId]);
  if (!log) return res.status(404).json({ error: 'Not found' });
  const isOwner = log.employee_id == req.user.employee_id;
  const isHR = ['HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isOwner && !isHR) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM time_logs WHERE id = ?', [req.params.logId]);
  res.json({ success: true });
});

router.get('/reports/utilization', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin', 'FinanceOfficer'), async (req, res) => {
  let sql = `
    SELECT e.id as employee_id, e.full_name,
      SUM(CASE WHEN tl.billable = true THEN tl.hours ELSE 0 END) as billable_hours,
      SUM(CASE WHEN tl.billable = false THEN tl.hours ELSE 0 END) as non_billable_hours,
      SUM(tl.hours) as total_hours
    FROM time_logs tl JOIN employees e ON tl.employee_id = e.id
  `;
  const params = [];
  if (req.user.role === 'Manager') { sql += ' WHERE e.manager_id = ?'; params.push(req.user.employee_id); }
  sql += ' GROUP BY e.id, e.full_name';
  const rows = await db.all(sql, params);
  res.json(rows.map(r => ({
    ...r,
    billable_pct: r.total_hours ? Math.round((r.billable_hours / r.total_hours) * 1000) / 10 : 0
  })));
});

router.get('/reports/staffing', authenticate, authorize('HRAdmin', 'SystemAdmin', 'FinanceOfficer'), async (req, res) => {
  const rows = await db.all(`
    SELECT p.id as project_id, p.name as project_name, p.donor, p.funding_source,
      COUNT(DISTINCT pa.employee_id) as headcount,
      STRING_AGG(DISTINCT pa.role_on_project, ',') as roles
    FROM projects p LEFT JOIN project_assignments pa ON pa.project_id = p.id
    GROUP BY p.id, p.name, p.donor, p.funding_source
  `);
  res.json(rows);
});

router.get('/reports/profitability', authenticate, authorize('HRAdmin', 'SystemAdmin', 'FinanceOfficer'), async (req, res) => {
  const rows = await db.all(`
    SELECT p.id as project_id, p.name as project_name,
      SUM(CASE WHEN tl.billable = true THEN tl.hours ELSE 0 END) as billable_hours,
      SUM(CASE WHEN tl.billable = false THEN tl.hours ELSE 0 END) as non_billable_hours
    FROM projects p LEFT JOIN time_logs tl ON tl.project_id = p.id
    GROUP BY p.id, p.name
  `);
  res.json(rows);
});

router.post('/reimbursements', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const { project_id, amount, description } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount required' });
  const info = await db.run(`
    INSERT INTO reimbursements (employee_id, project_id, amount, description) VALUES (?, ?, ?, ?)
  `, [req.user.employee_id, project_id || null, amount, description || null]);
  res.status(201).json({ id: info.id, status: 'Pending' });
});

router.get('/reimbursements', authenticate, authorize('FinanceOfficer', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  res.json(await db.all(`
    SELECT r.*, e.full_name, p.name as project_name FROM reimbursements r
    JOIN employees e ON r.employee_id = e.id LEFT JOIN projects p ON r.project_id = p.id
    ORDER BY r.created_at DESC
  `));
});

router.put('/reimbursements/:id', authenticate, authorize('FinanceOfficer', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { status } = req.body;
  if (!['Approved', 'Rejected', 'Paid'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await db.run('UPDATE reimbursements SET status = ? WHERE id = ?', [status, req.params.id]);
  await logAudit(req.user.id, 'UPDATE_REIMBURSEMENT', 'reimbursements', req.params.id, { status });
  res.json({ success: true });
});

router.delete('/reimbursements/:id', authenticate, async (req, res) => {
  const claim = await db.get('SELECT * FROM reimbursements WHERE id = ?', [req.params.id]);
  if (!claim) return res.status(404).json({ error: 'Not found' });
  const isOwner = claim.employee_id == req.user.employee_id;
  const isFinanceOrHR = ['FinanceOfficer', 'HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isOwner && !isFinanceOrHR) return res.status(403).json({ error: 'Forbidden' });
  if (isOwner && !isFinanceOrHR && claim.status !== 'Pending') {
    return res.status(400).json({ error: 'Only pending claims can be cancelled' });
  }
  await db.run('DELETE FROM reimbursements WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Employee's own reimbursement claims
router.get('/my-reimbursements', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  res.json(await db.all(`
    SELECT r.*, p.name as project_name FROM reimbursements r LEFT JOIN projects p ON r.project_id = p.id
    WHERE r.employee_id = ? ORDER BY r.created_at DESC
  `, [req.user.employee_id]));
});

router.get('/staffing/search-by-skill', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { skill } = req.query;
  if (!skill) return res.status(400).json({ error: 'skill query param required' });
  const rows = await db.all(`
    SELECT e.id, e.full_name, e.employment_type FROM employees e
    JOIN employee_skills es ON es.employee_id = e.id
    JOIN skills sk ON sk.id = es.skill_id
    WHERE sk.name = ? AND e.status = 'Active'
  `, [skill]);
  res.json(rows);
});

router.get('/volunteers', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const rows = await db.all(`
    SELECT DISTINCT e.* FROM employees e JOIN project_assignments pa ON pa.employee_id = e.id WHERE pa.is_volunteer = true
  `);
  res.json(rows);
});

module.exports = router;
