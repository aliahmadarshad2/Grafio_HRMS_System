const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.post('/cycles', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { name, cycle_type, start_date, end_date } = req.body;
  if (!name || !cycle_type) return res.status(400).json({ error: 'name and cycle_type required' });
  const info = await db.run('INSERT INTO review_cycles (name, cycle_type, start_date, end_date) VALUES (?, ?, ?, ?)',
    [name, cycle_type, start_date || null, end_date || null]);
  res.status(201).json({ id: info.id });
});

router.get('/cycles', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM review_cycles ORDER BY start_date DESC'));
});

router.put('/cycles/:id', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const fields = ['name', 'cycle_type', 'start_date', 'end_date'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE review_cycles SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/cycles/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM review_cycles WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/goals', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { employee_id, cycle_id, title, description } = req.body;
  if (!employee_id || !title) return res.status(400).json({ error: 'employee_id and title required' });
  const info = await db.run('INSERT INTO goals (employee_id, cycle_id, title, description) VALUES (?, ?, ?, ?)',
    [employee_id, cycle_id || null, title, description || null]);
  res.status(201).json({ id: info.id });
});

router.get('/goals/:employee_id', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM goals WHERE employee_id = ?', [req.params.employee_id]));
});

router.put('/goals/:id', authenticate, async (req, res) => {
  const { status, title, description } = req.body;
  const updates = [];
  const params = [];
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE goals SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/goals/:id', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM goals WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/reviews', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  const { cycle_id, self_assessment } = req.body;
  const existing = await db.get('SELECT * FROM performance_reviews WHERE employee_id = ? AND cycle_id = ?',
    [req.user.employee_id, cycle_id]);
  if (existing) {
    await db.run('UPDATE performance_reviews SET self_assessment = ?, status = \'SelfSubmitted\' WHERE id = ?',
      [self_assessment, existing.id]);
    return res.json({ id: existing.id, status: 'SelfSubmitted' });
  }
  const info = await db.run(`
    INSERT INTO performance_reviews (employee_id, cycle_id, self_assessment, status) VALUES (?, ?, ?, 'SelfSubmitted')
  `, [req.user.employee_id, cycle_id || null, self_assessment || null]);
  res.status(201).json({ id: info.id, status: 'SelfSubmitted' });
});

router.put('/reviews/:id', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { manager_rating, manager_feedback } = req.body;
  await db.run(`
    UPDATE performance_reviews SET manager_rating = ?, manager_feedback = ?, status = 'Completed' WHERE id = ?
  `, [manager_rating, manager_feedback, req.params.id]);
  await logAudit(req.user.id, 'SUBMIT_PERFORMANCE_REVIEW', 'performance_reviews', req.params.id);
  res.json({ success: true });
});

router.post('/intern-evaluations', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { employee_id, rating, feedback } = req.body;
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [employee_id]);
  if (!emp || emp.employment_type !== 'Intern') return res.status(400).json({ error: 'Employee is not an intern' });

  const info = await db.run(`
    INSERT INTO performance_reviews (employee_id, manager_rating, manager_feedback, is_internship_eval, status)
    VALUES (?, ?, ?, true, 'Completed')
  `, [employee_id, rating || null, feedback || null]);
  await logAudit(req.user.id, 'INTERN_EVALUATION', 'performance_reviews', info.id);
  res.status(201).json({ id: info.id });
});

router.get('/reviews/:employee_id', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM performance_reviews WHERE employee_id = ?', [req.params.employee_id]));
});

router.delete('/reviews/:id', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM performance_reviews WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.get('/reports/org-wide', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  res.json(await db.all(`
    SELECT e.department_id, d.name as department_name, AVG(pr.manager_rating) as avg_rating, COUNT(*) as review_count
    FROM performance_reviews pr JOIN employees e ON pr.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE pr.manager_rating IS NOT NULL
    GROUP BY e.department_id, d.name
  `));
});

module.exports = router;
