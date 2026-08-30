const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

function makeLookupRoutes(table) {
  const nameField = table === 'designations' ? 'title' : 'name';

  router.post(`/${table}`, authenticate, authorize('SystemAdmin', 'HRAdmin'), async (req, res) => {
    if (!req.body[nameField]) return res.status(400).json({ error: `${nameField} required` });
    try {
      const info = await db.run(`INSERT INTO ${table} (${nameField}) VALUES (?)`, [req.body[nameField]]);
      await logAudit(req.user.id, `CREATE_${table.toUpperCase()}`, table, info.id, req.body);
      res.status(201).json({ id: info.id, [nameField]: req.body[nameField] });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get(`/${table}`, authenticate, async (req, res) => {
    res.json(await db.all(`SELECT * FROM ${table} ORDER BY ${nameField}`));
  });

  router.put(`/${table}/:id`, authenticate, authorize('SystemAdmin', 'HRAdmin'), async (req, res) => {
    if (!req.body[nameField]) return res.status(400).json({ error: `${nameField} required` });
    try {
      await db.run(`UPDATE ${table} SET ${nameField} = ? WHERE id = ?`, [req.body[nameField], req.params.id]);
      await logAudit(req.user.id, `UPDATE_${table.toUpperCase()}`, table, req.params.id, req.body);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete(`/${table}/:id`, authenticate, authorize('SystemAdmin', 'HRAdmin'), async (req, res) => {
    try {
      await db.run(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      await logAudit(req.user.id, `DELETE_${table.toUpperCase()}`, table, req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
makeLookupRoutes('departments');
makeLookupRoutes('designations');
makeLookupRoutes('locations');

// ===== Skills (create/list/delete — used for staffing tags) =====
router.post('/skills', authenticate, authorize('SystemAdmin', 'HRAdmin', 'Manager'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = await db.run('INSERT INTO skills (name) VALUES (?)', [name]);
    res.status(201).json({ id: info.id, name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
router.get('/skills', authenticate, async (req, res) => {
  res.json(await db.all('SELECT * FROM skills ORDER BY name'));
});
router.delete('/skills/:id', authenticate, authorize('SystemAdmin', 'HRAdmin'), async (req, res) => {
  await db.run('DELETE FROM skills WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_SKILL', 'skills', req.params.id);
  res.json({ success: true });
});

router.get('/audit-logs', authenticate, authorize('SystemAdmin', 'HRAdmin'), async (req, res) => {
  const rows = await db.all(`
    SELECT al.*, u.email as user_email FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC LIMIT 200
  `);
  res.json(rows);
});

router.post('/backup', authenticate, authorize('SystemAdmin'), async (req, res) => {
  await logAudit(req.user.id, 'TRIGGER_BACKUP', 'system', null);
  res.json({ success: true, message: 'Backup triggered (simulated). In production this would export the DB to secure storage.' });
});

router.get('/reports/headcount', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const byType = await db.all(`
    SELECT employment_type, COUNT(*) as count FROM employees WHERE status = 'Active' GROUP BY employment_type
  `);
  const byDept = await db.all(`
    SELECT d.name as department, COUNT(*) as count FROM employees e LEFT JOIN departments d ON e.department_id = d.id
    WHERE e.status = 'Active' GROUP BY e.department_id, d.name
  `);
  const totalActiveRow = await db.get(`SELECT COUNT(*) as c FROM employees WHERE status = 'Active'`);
  const totalOffboardedRow = await db.get(`SELECT COUNT(*) as c FROM employees WHERE status = 'Offboarded'`);
  const totalActive = Number(totalActiveRow.c);
  const totalOffboarded = Number(totalOffboardedRow.c);
  const attritionRate = (totalActive + totalOffboarded) > 0
    ? Math.round((totalOffboarded / (totalActive + totalOffboarded)) * 1000) / 10 : 0;
  res.json({ byType, byDept, totalActive, totalOffboarded, attritionRate });
});

router.get('/reports/team-dashboard', authenticate, authorize('Manager', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  let teamFilter = '';
  const params = [];
  if (req.user.role === 'Manager') {
    teamFilter = 'WHERE e.manager_id = ?';
    params.push(req.user.employee_id);
  }
  const attendanceStats = await db.all(`
    SELECT e.id, e.full_name,
      COUNT(a.id) as days_recorded,
      SUM(CASE WHEN a.status = 'Present' OR a.status='Corrected' THEN 1 ELSE 0 END) as days_present
    FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id
    ${teamFilter}
    GROUP BY e.id, e.full_name
  `, params);
  res.json(attendanceStats.map(s => ({
    ...s,
    attendance_pct: s.days_recorded > 0 ? Math.round((s.days_present / s.days_recorded) * 1000) / 10 : null
  })));
});

router.get('/reports/export/:reportType', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { reportType } = req.params;
  let rows = [];
  if (reportType === 'headcount') {
    rows = await db.all(`SELECT employment_type, COUNT(*) as count FROM employees WHERE status='Active' GROUP BY employment_type`);
  } else if (reportType === 'leave') {
    rows = await db.all(`SELECT employee_id, leave_type, days, status FROM leave_requests`);
  } else {
    return res.status(400).json({ error: 'Unknown report type. Use headcount or leave.' });
  }
  if (!rows.length) return res.json({ message: 'No data to export' });
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => r[h]).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${reportType}_report.csv`);
  res.send(csv);
});

module.exports = router;
