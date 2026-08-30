const express = require('express');
const db = require('../db/pg');
const { authenticate, authorize, logAudit } = require('../middleware/auth');

const router = express.Router();

router.post('/compensation/:employee_id', authenticate, authorize('FinanceOfficer', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { basic_salary, stipend_amount, contractor_rate, currency } = req.body;
  await db.run(`
    INSERT INTO compensation (employee_id, basic_salary, stipend_amount, contractor_rate, currency)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET
      basic_salary = excluded.basic_salary, stipend_amount = excluded.stipend_amount,
      contractor_rate = excluded.contractor_rate, currency = excluded.currency
  `, [req.params.employee_id, basic_salary || null, stipend_amount || null, contractor_rate || null, currency || 'USD']);
  await logAudit(req.user.id, 'UPDATE_COMPENSATION', 'compensation', req.params.employee_id);
  res.json({ success: true });
});

router.get('/compensation/:employee_id', authenticate, authorize('FinanceOfficer', 'HRAdmin', 'SystemAdmin'), async (req, res) => {
  const comp = await db.get('SELECT * FROM compensation WHERE employee_id = ?', [req.params.employee_id]);
  res.json(comp || {});
});

router.post('/runs', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const { period_month, period_year } = req.body;
  if (!period_month || !period_year) return res.status(400).json({ error: 'period_month and period_year required' });
  const info = await db.run('INSERT INTO payroll_runs (period_month, period_year) VALUES (?, ?)', [period_month, period_year]);
  res.status(201).json({ id: info.id, status: 'Draft' });
});

router.get('/runs', authenticate, authorize('HRAdmin', 'SystemAdmin', 'FinanceOfficer'), async (req, res) => {
  res.json(await db.all('SELECT * FROM payroll_runs ORDER BY period_year DESC, period_month DESC'));
});

router.delete('/runs/:id', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const run = await db.get('SELECT * FROM payroll_runs WHERE id = ?', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (run.status !== 'Draft') return res.status(400).json({ error: 'Only draft (unprocessed) runs can be deleted' });
  await db.run('DELETE FROM payroll_runs WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/runs/:id/process', authenticate, authorize('HRAdmin', 'SystemAdmin'), async (req, res) => {
  const run = await db.get('SELECT * FROM payroll_runs WHERE id = ?', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Payroll run not found' });

  const employees = await db.all(`SELECT * FROM employees WHERE status = 'Active'`);
  const items = [];

  for (const emp of employees) {
    const comp = await db.get('SELECT * FROM compensation WHERE employee_id = ?', [emp.id]);

    if (emp.employment_type === 'Full-time' || emp.employment_type === 'Part-time') {
      const basic = (comp && comp.basic_salary) || 0;
      const deductions = Math.round(basic * 0.1 * 100) / 100;
      const net = basic - deductions;
      const info = await db.run(`
        INSERT INTO payroll_items (payroll_run_id, employee_id, pay_type, basic_amount, deductions, net_amount, notes)
        VALUES (?, ?, 'FullPayroll', ?, ?, ?, ?)
      `, [run.id, emp.id, basic, deductions, net, null]);
      items.push({ id: info.id, employee: emp.full_name, pay_type: 'FullPayroll', net_amount: net });

    } else if (emp.employment_type === 'Intern') {
      const stipend = (comp && comp.stipend_amount) || 0;
      const info = await db.run(`
        INSERT INTO payroll_items (payroll_run_id, employee_id, pay_type, basic_amount, deductions, net_amount, notes)
        VALUES (?, ?, 'InternStipend', ?, 0, ?, 'Flat stipend, no payroll tax logic applied')
      `, [run.id, emp.id, stipend, stipend]);
      items.push({ id: info.id, employee: emp.full_name, pay_type: 'InternStipend', net_amount: stipend });

    } else if (emp.employment_type === 'Contractor') {
      const rate = (comp && comp.contractor_rate) || 0;
      const hoursRow = await db.get(`
        SELECT COALESCE(SUM(hours),0) as total FROM time_logs
        WHERE employee_id = ? AND EXTRACT(MONTH FROM date) = ? AND EXTRACT(YEAR FROM date) = ?
      `, [emp.id, run.period_month, run.period_year]);
      const hours = hoursRow ? Number(hoursRow.total) : 0;
      const amount = Math.round(rate * hours * 100) / 100;
      const info = await db.run(`
        INSERT INTO payroll_items (payroll_run_id, employee_id, pay_type, basic_amount, deductions, net_amount, notes)
        VALUES (?, ?, 'ContractorInvoice', ?, 0, ?, 'Invoice-based, no benefits/leave applicable')
      `, [run.id, emp.id, amount, amount]);
      items.push({ id: info.id, employee: emp.full_name, pay_type: 'ContractorInvoice', net_amount: amount });
    }
  }

  await db.run(`UPDATE payroll_runs SET status = 'Processed' WHERE id = ?`, [run.id]);
  await logAudit(req.user.id, 'PROCESS_PAYROLL', 'payroll_runs', run.id, { items_count: items.length });
  res.json({ run_id: run.id, status: 'Processed', items });
});

router.get('/runs/:id/items', authenticate, authorize('HRAdmin', 'SystemAdmin', 'FinanceOfficer'), async (req, res) => {
  res.json(await db.all(`
    SELECT pi.*, e.full_name, e.employment_type FROM payroll_items pi
    JOIN employees e ON pi.employee_id = e.id WHERE pi.payroll_run_id = ?
  `, [req.params.id]));
});

router.get('/my-payslips', authenticate, async (req, res) => {
  if (!req.user.employee_id) return res.status(400).json({ error: 'No employee profile' });
  res.json(await db.all(`
    SELECT pi.*, pr.period_month, pr.period_year, pr.status as run_status
    FROM payroll_items pi JOIN payroll_runs pr ON pi.payroll_run_id = pr.id
    WHERE pi.employee_id = ? ORDER BY pr.period_year DESC, pr.period_month DESC
  `, [req.user.employee_id]));
});

module.exports = router;
