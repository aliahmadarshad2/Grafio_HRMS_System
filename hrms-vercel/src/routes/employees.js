const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = (new Date(dateStr) - new Date());
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

router.post('/', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const b = req.body;
  if (!b.full_name || !b.email || !b.employment_type) {
    return res.status(400).json({ error: 'full_name, email, employment_type are required' });
  }
  if (!['Full-time', 'Part-time', 'Contractor', 'Intern'].includes(b.employment_type)) {
    return res.status(400).json({ error: 'Invalid employment_type' });
  }

  const sql = `
    INSERT INTO employees (
      full_name, email, phone, address, emergency_contact, department_id, designation_id,
      location_id, manager_id, employment_type, hire_date, bank_details,
      internship_start_date, internship_end_date, mentor_id, university, course_program, institution_supervisor,
      contract_start_date, contract_end_date, engagement_scope
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    b.full_name, b.email, b.phone || null, b.address || null, b.emergency_contact || null,
    b.department_id || null, b.designation_id || null, b.location_id || null, b.manager_id || null,
    b.employment_type, b.hire_date || null, b.bank_details || null,
    b.internship_start_date || null, b.internship_end_date || null, b.mentor_id || null,
    b.university || null, b.course_program || null, b.institution_supervisor || null,
    b.contract_start_date || null, b.contract_end_date || null, b.engagement_scope || null
  ];

  try {
    const info = await db.run(sql, params);
    const employeeId = info.id;

    if (b.employment_type === 'Intern') {
      const policy = await db.get(`SELECT * FROM leave_policies WHERE applies_to = 'Intern' LIMIT 1`);
      if (policy) {
        await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Flat', ?) ON CONFLICT DO NOTHING`,
          [employeeId, policy.annual_days]);
      }
    } else if (b.employment_type !== 'Contractor') {
      await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Annual', 15) ON CONFLICT DO NOTHING`, [employeeId]);
      await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Sick', 10) ON CONFLICT DO NOTHING`, [employeeId]);
      await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Casual', 8) ON CONFLICT DO NOTHING`, [employeeId]);
    }

    await logAudit(req.user.id, 'CREATE_EMPLOYEE', 'employees', employeeId, { name: b.full_name, type: b.employment_type });
    const emp = await db.get('SELECT * FROM employees WHERE id = ?', [employeeId]);
    res.status(201).json(emp);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager', 'FinanceOfficer'), async (req, res) => {
  const { employment_type, status, department_id, manager_id, skill } = req.query;
  let sql = `SELECT e.*, d.name as department_name, des.title as designation_title, l.name as location_name
             FROM employees e
             LEFT JOIN departments d ON e.department_id = d.id
             LEFT JOIN designations des ON e.designation_id = des.id
             LEFT JOIN locations l ON e.location_id = l.id`;
  const where = [];
  const params = [];
  if (skill) {
    sql += ` JOIN employee_skills es ON es.employee_id = e.id JOIN skills sk ON sk.id = es.skill_id`;
    where.push('sk.name = ?'); params.push(skill);
  }
  if (employment_type) { where.push('e.employment_type = ?'); params.push(employment_type); }
  if (status) { where.push('e.status = ?'); params.push(status); }
  if (department_id) { where.push('e.department_id = ?'); params.push(department_id); }
  if (manager_id) { where.push('e.manager_id = ?'); params.push(manager_id); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  const rows = await db.all(sql, params);
  res.json(rows);
});

router.get('/interns/expiring', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const windowDays = parseInt(req.query.days || '14', 10);
  const interns = await db.all(`SELECT * FROM employees WHERE employment_type = 'Intern' AND status = 'Active' AND internship_end_date IS NOT NULL`);
  const expiring = interns.filter(i => {
    const d = daysUntil(i.internship_end_date);
    return d !== null && d >= 0 && d <= windowDays;
  }).map(i => ({ ...i, days_remaining: daysUntil(i.internship_end_date) }));
  res.json(expiring);
});

router.get('/org-chart', authenticate, async (req, res) => {
  const employees = await db.all('SELECT id, full_name, manager_id, designation_id FROM employees WHERE status = \'Active\'');
  const map = {};
  employees.forEach(e => map[e.id] = { ...e, children: [] });
  const roots = [];
  employees.forEach(e => {
    if (e.manager_id && map[e.manager_id]) map[e.manager_id].children.push(map[e.id]);
    else roots.push(map[e.id]);
  });
  res.json(roots);
});

router.get('/:id', authenticate, async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'Employee' && req.user.employee_id != req.params.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(emp);
});

router.put('/:id', authenticate, async (req, res) => {
  const isSelf = req.user.employee_id == req.params.id;
  const isHR = ['HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isSelf && !isHR) return res.status(403).json({ error: 'Forbidden' });

  const selfEditableFields = ['phone', 'address', 'emergency_contact'];
  const hrFields = [
    'full_name', 'email', 'phone', 'address', 'emergency_contact', 'department_id', 'designation_id',
    'location_id', 'manager_id', 'employment_type', 'hire_date', 'bank_details', 'status',
    'internship_start_date', 'internship_end_date', 'mentor_id', 'university', 'course_program',
    'institution_supervisor', 'contract_start_date', 'contract_end_date', 'engagement_scope'
  ];
  const allowedFields = isHR ? hrFields : selfEditableFields;
  const updates = [];
  const params = [];
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
  params.push(req.params.id);
  await db.run(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`, params);
  await logAudit(req.user.id, 'UPDATE_EMPLOYEE', 'employees', req.params.id, req.body);
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  res.json(emp);
});

router.post('/:id/offboard', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run(`UPDATE employees SET status = 'Offboarded' WHERE id = ?`, [req.params.id]);
  await logAudit(req.user.id, 'OFFBOARD_EMPLOYEE', 'employees', req.params.id, { reason: req.body.reason });
  res.json({ success: true, message: 'Employee offboarded. Exit document generation would be triggered here.' });
});

// Hard delete — permanently removes the employee and all dependent records
// (attendance, leave, assignments, payroll history, etc. via cascading FKs).
// Restricted to SystemAdmin since this is irreversible, unlike offboarding.
router.delete('/:id', authenticate, authorize('SystemAdmin'), async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  await db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_EMPLOYEE', 'employees', req.params.id, { name: emp.full_name });
  res.json({ success: true });
});

router.post('/:id/convert-to-fulltime', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (emp.employment_type !== 'Intern') return res.status(400).json({ error: 'Employee is not an intern' });

  await db.run(`
    UPDATE employees SET employment_type = 'Full-time', hire_date = COALESCE(?, hire_date)
    WHERE id = ?
  `, [req.body.hire_date || emp.hire_date, req.params.id]);

  await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Annual', 15) ON CONFLICT DO NOTHING`, [req.params.id]);
  await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Sick', 10) ON CONFLICT DO NOTHING`, [req.params.id]);
  await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Casual', 8) ON CONFLICT DO NOTHING`, [req.params.id]);

  if (req.body.basic_salary) {
    await db.run(`
      INSERT INTO compensation (employee_id, basic_salary, currency) VALUES (?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET basic_salary = excluded.basic_salary
    `, [req.params.id, req.body.basic_salary, req.body.currency || 'USD']);
  }

  await logAudit(req.user.id, 'CONVERT_INTERN_TO_FULLTIME', 'employees', req.params.id);
  const updated = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  res.json(updated);
});

router.post('/interns/process-expirations', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const expired = await db.all(`
    SELECT * FROM employees WHERE employment_type = 'Intern' AND status = 'Active' AND internship_end_date <= ?
  `, [today]);
  const processed = [];
  for (const i of expired) {
    await db.run(`UPDATE employees SET status = 'Offboarded' WHERE id = ?`, [i.id]);
    await logAudit(req.user.id, 'AUTO_OFFBOARD_INTERN', 'employees', i.id, { internship_end_date: i.internship_end_date });
    processed.push({ id: i.id, name: i.full_name, completion_letter: `Completion letter generated for ${i.full_name}` });
  }
  res.json({ processed_count: processed.length, processed });
});

router.post('/:id/documents', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { doc_type, file_name } = req.body;
  if (!doc_type || !file_name) return res.status(400).json({ error: 'doc_type and file_name required' });
  const info = await db.run('INSERT INTO employee_documents (employee_id, doc_type, file_name) VALUES (?, ?, ?)',
    [req.params.id, doc_type, file_name]);
  res.status(201).json({ id: info.id, doc_type, file_name });
});

router.get('/:id/documents', authenticate, async (req, res) => {
  const isSelf = req.user.employee_id == req.params.id;
  const isHR = ['HRAdmin', 'SystemAdmin'].includes(req.user.role);
  if (!isSelf && !isHR) return res.status(403).json({ error: 'Forbidden' });
  res.json(await db.all('SELECT * FROM employee_documents WHERE employee_id = ?', [req.params.id]));
});

router.delete('/:id/documents/:docId', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  await db.run('DELETE FROM employee_documents WHERE id = ? AND employee_id = ?', [req.params.docId, req.params.id]);
  res.json({ success: true });
});

router.post('/:id/skills', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  const { skill_name } = req.body;
  if (!skill_name) return res.status(400).json({ error: 'skill_name required' });
  let skill = await db.get('SELECT * FROM skills WHERE name = ?', [skill_name]);
  if (!skill) {
    const info = await db.run('INSERT INTO skills (name) VALUES (?)', [skill_name]);
    skill = { id: info.id, name: skill_name };
  }
  await db.run('INSERT INTO employee_skills (employee_id, skill_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [req.params.id, skill.id]);
  res.status(201).json({ success: true });
});

router.get('/:id/skills', authenticate, async (req, res) => {
  const rows = await db.all(`
    SELECT sk.* FROM skills sk JOIN employee_skills es ON es.skill_id = sk.id WHERE es.employee_id = ?
  `, [req.params.id]);
  res.json(rows);
});

router.delete('/:id/skills/:skillId', authenticate, authorize('HRAdmin', 'SystemAdmin', 'Manager'), async (req, res) => {
  await db.run('DELETE FROM employee_skills WHERE employee_id = ? AND skill_id = ?', [req.params.id, req.params.skillId]);
  res.json({ success: true });
});

router.get('/upcoming-events', authenticate, async (req, res) => {
  const windowDays = parseInt(req.query.days || '30', 10);
  const employees = await db.all(`
    SELECT id, full_name, date_of_birth, hire_date FROM employees WHERE status = 'Active'
  `);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function nextOccurrence(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next.setFullYear(next.getFullYear() + 1);
    return next;
  }
  function daysBetween(a, b) { return Math.round((b - a) / (1000 * 60 * 60 * 24)); }

  const events = [];
  for (const e of employees) {
    const bday = nextOccurrence(e.date_of_birth);
    if (bday && daysBetween(today, bday) <= windowDays) {
      events.push({ employee_id: e.id, full_name: e.full_name, type: 'Birthday', date: bday.toISOString().slice(0, 10), days_until: daysBetween(today, bday) });
    }
    const anniv = nextOccurrence(e.hire_date);
    if (anniv && e.hire_date && daysBetween(today, anniv) <= windowDays) {
      const years = new Date(anniv).getFullYear() - new Date(e.hire_date).getFullYear();
      if (years > 0) {
        events.push({ employee_id: e.id, full_name: e.full_name, type: 'Anniversary', date: anniv.toISOString().slice(0, 10), days_until: daysBetween(today, anniv), years });
      }
    }
  }
  events.sort((a, b) => a.days_until - b.days_until);
  res.json(events);
});

module.exports = router;
