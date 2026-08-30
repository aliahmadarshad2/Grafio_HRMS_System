const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.post('/requisitions', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { title, department_id, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = await db.run('INSERT INTO job_requisitions (title, department_id, description) VALUES (?, ?, ?)',
    [title, department_id || null, description || null]);
  res.status(201).json({ id: info.id });
});

router.get('/requisitions', authenticate, async (req, res) => {
  res.json(await db.all(`
    SELECT r.*, d.name as department_name FROM job_requisitions r LEFT JOIN departments d ON r.department_id = d.id
  `));
});

router.put('/requisitions/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const fields = ['title', 'department_id', 'description', 'status'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE job_requisitions SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/requisitions/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM job_requisitions WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_REQUISITION', 'job_requisitions', req.params.id);
  res.json({ success: true });
});

router.post('/requisitions/:id/candidates', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { full_name, email, phone } = req.body;
  if (!full_name) return res.status(400).json({ error: 'full_name required' });
  const info = await db.run('INSERT INTO candidates (requisition_id, full_name, email, phone) VALUES (?, ?, ?, ?)',
    [req.params.id, full_name, email || null, phone || null]);
  res.status(201).json({ id: info.id, stage: 'Applied' });
});

router.get('/requisitions/:id/candidates', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  res.json(await db.all('SELECT * FROM candidates WHERE requisition_id = ?', [req.params.id]));
});

router.delete('/candidates/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM candidates WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.put('/candidates/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { stage, interview_datetime } = req.body;
  const updates = [];
  const params = [];
  if (stage) { updates.push('stage = ?'); params.push(stage); }
  if (interview_datetime) { updates.push('interview_datetime = ?'); params.push(interview_datetime); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  await db.run(`UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`, params);

  if (interview_datetime) {
    await logAudit(req.user.id, 'SCHEDULE_INTERVIEW', 'candidates', req.params.id, { interview_datetime });
  }
  res.json({ success: true });
});

router.post('/candidates/:id/hire', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const candidate = await db.get('SELECT * FROM candidates WHERE id = ?', [req.params.id]);
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
  const b = req.body;
  const employmentType = b.employment_type || 'Full-time';

  const info = await db.run(`
    INSERT INTO employees (full_name, email, phone, employment_type, hire_date, department_id, designation_id, manager_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [candidate.full_name, candidate.email || `${candidate.full_name.replace(/\s+/g, '.').toLowerCase()}@agency.local`,
    candidate.phone, employmentType, b.hire_date || new Date().toISOString().slice(0, 10),
    b.department_id || null, b.designation_id || null, b.manager_id || null]);

  await db.run(`UPDATE candidates SET stage = 'Hired' WHERE id = ?`, [req.params.id]);
  await logAudit(req.user.id, 'HIRE_CANDIDATE', 'employees', info.id, { candidate_id: req.params.id });
  res.status(201).json({ employee_id: info.id });
});

router.get('/onboarding/:employee_id/checklist', authenticate, async (req, res) => {
  const docs = await db.all('SELECT * FROM employee_documents WHERE employee_id = ?', [req.params.employee_id]);
  const required = ['ID', 'Contract', 'Tax Form'];
  const submitted = docs.map(d => d.doc_type);
  const checklist = required.map(r => ({ item: r, completed: submitted.includes(r) }));
  res.json(checklist);
});

module.exports = router;
