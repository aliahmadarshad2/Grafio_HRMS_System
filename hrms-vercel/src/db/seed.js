require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./pg');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

async function seed() {
  await db.ensureSchema();

  const existingRow = await db.get('SELECT COUNT(*) as c FROM employees');
  if (Number(existingRow.c) > 0) {
    console.log(`Database already has ${existingRow.c} employee(s) — skipping seed.`);
    return;
  }

  console.log('Database is empty — seeding sample data...');

  const deptIds = {};
  for (const n of ['Marketing', 'Creative', 'Client Services', 'Operations', 'Finance']) {
    const info = await db.run('INSERT INTO departments (name) VALUES (?)', [n]);
    deptIds[n] = info.id;
  }

  const desigIds = {};
  for (const t of ['CEO', 'HR Manager', 'Marketing Manager', 'Content Strategist', 'SEO Specialist', 'Graphic Designer', 'Marketing Intern', 'Freelance Copywriter', 'Finance Officer', 'System Administrator']) {
    const info = await db.run('INSERT INTO designations (title) VALUES (?)', [t]);
    desigIds[t] = info.id;
  }

  const locIds = {};
  for (const n of ['Head Office - Lahore', 'Remote']) {
    const info = await db.run('INSERT INTO locations (name) VALUES (?)', [n]);
    locIds[n] = info.id;
  }

  await db.run(`INSERT INTO leave_policies (name, applies_to, annual_days, sick_days, casual_days, accrual_type) VALUES (?, ?, ?, ?, ?, ?)`,
    ['Standard Staff Policy', 'Standard', 18, 10, 8, 'monthly']);
  await db.run(`INSERT INTO leave_policies (name, applies_to, annual_days, sick_days, casual_days, accrual_type) VALUES (?, ?, ?, ?, ?, ?)`,
    ['Intern Flat Allowance', 'Intern', 5, 0, 0, 'flat']);

  async function insertEmployee(o) {
    const sql = `
      INSERT INTO employees (
        full_name, email, phone, address, emergency_contact, department_id, designation_id, location_id, manager_id,
        employment_type, hire_date, bank_details,
        internship_start_date, internship_end_date, mentor_id, university, course_program, institution_supervisor,
        contract_start_date, contract_end_date, engagement_scope
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      o.full_name, o.email, o.phone || null, o.address || null, o.emergency_contact || null,
      o.department_id || null, o.designation_id || null, o.location_id || locIds['Head Office - Lahore'], o.manager_id || null,
      o.employment_type || 'Full-time', o.hire_date || null, o.bank_details || null,
      o.internship_start_date || null, o.internship_end_date || null, o.mentor_id || null,
      o.university || null, o.course_program || null, o.institution_supervisor || null,
      o.contract_start_date || null, o.contract_end_date || null, o.engagement_scope || null
    ];
    const info = await db.run(sql, params);
    return info.id;
  }

  const ceoId = await insertEmployee({
    full_name: 'Ayesha Khan', email: 'ayesha.khan@agency.local', phone: '+92-300-1000001',
    department_id: deptIds['Operations'], designation_id: desigIds['CEO'], hire_date: '2019-01-15'
  });

  const hrAdminId = await insertEmployee({
    full_name: 'Bilal Ahmed', email: 'bilal.ahmed@agency.local', phone: '+92-300-1000002',
    department_id: deptIds['Operations'], designation_id: desigIds['HR Manager'], manager_id: ceoId, hire_date: '2020-03-01'
  });

  const mgrId = await insertEmployee({
    full_name: 'Sara Malik', email: 'sara.malik@agency.local', phone: '+92-300-1000003',
    department_id: deptIds['Marketing'], designation_id: desigIds['Marketing Manager'], manager_id: ceoId, hire_date: '2020-06-15'
  });

  const fullTimeId = await insertEmployee({
    full_name: 'Usman Tariq', email: 'usman.tariq@agency.local', phone: '+92-300-1000004',
    address: 'DHA Phase 5, Lahore', emergency_contact: 'Wife - +92-300-9999999',
    department_id: deptIds['Marketing'], designation_id: desigIds['Content Strategist'], manager_id: mgrId,
    employment_type: 'Full-time', hire_date: '2022-02-01', bank_details: 'MCB **** 4521'
  });

  const fullTime2Id = await insertEmployee({
    full_name: 'Fatima Zahra', email: 'fatima.zahra@agency.local', phone: '+92-300-1000005',
    department_id: deptIds['Marketing'], designation_id: desigIds['SEO Specialist'], manager_id: mgrId,
    employment_type: 'Full-time', hire_date: '2023-05-10', bank_details: 'HBL **** 7788'
  });

  const sysAdminEmpId = await insertEmployee({
    full_name: 'Hamza Raza', email: 'hamza.raza@agency.local', phone: '+92-300-1000006',
    department_id: deptIds['Operations'], designation_id: desigIds['System Administrator'], manager_id: ceoId, hire_date: '2021-01-01'
  });

  const financeEmpId = await insertEmployee({
    full_name: 'Zainab Iqbal', email: 'zainab.iqbal@agency.local', phone: '+92-300-1000007',
    department_id: deptIds['Finance'], designation_id: desigIds['Finance Officer'], manager_id: ceoId, hire_date: '2021-08-01'
  });

  const internId = await insertEmployee({
    full_name: 'Ali Raza', email: 'ali.raza@agency.local', phone: '+92-300-1000008',
    department_id: deptIds['Marketing'], designation_id: desigIds['Marketing Intern'], manager_id: mgrId,
    employment_type: 'Intern', hire_date: '2026-06-01',
    internship_start_date: '2026-06-01', internship_end_date: '2026-09-10',
    mentor_id: fullTimeId, university: 'LUMS', course_program: 'BSc Management Science',
    institution_supervisor: 'Dr. Nadia Sheikh'
  });

  const contractorId = await insertEmployee({
    full_name: 'Omar Farooq', email: 'omar.farooq@agency.local', phone: '+92-300-1000009',
    department_id: deptIds['Creative'], designation_id: desigIds['Freelance Copywriter'], manager_id: mgrId,
    employment_type: 'Contractor', location_id: locIds['Remote'],
    contract_start_date: '2026-04-01', contract_end_date: '2026-12-31',
    engagement_scope: 'Blog and ad copywriting, 20 hrs/month retainer'
  });

  console.log('Employees seeded:', { ceoId, hrAdminId, mgrId, fullTimeId, fullTime2Id, sysAdminEmpId, financeEmpId, internId, contractorId });

  for (const id of [ceoId, hrAdminId, mgrId, fullTimeId, fullTime2Id, sysAdminEmpId, financeEmpId]) {
    await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Annual', 18)`, [id]);
    await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Sick', 10)`, [id]);
    await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Casual', 8)`, [id]);
  }
  await db.run(`INSERT INTO leave_balances (employee_id, leave_type, balance) VALUES (?, 'Flat', 5)`, [internId]);

  await db.run(`INSERT INTO compensation (employee_id, basic_salary, currency) VALUES (?, ?, ?)`, [fullTimeId, 180000, 'PKR']);
  await db.run(`INSERT INTO compensation (employee_id, basic_salary, currency) VALUES (?, ?, ?)`, [fullTime2Id, 160000, 'PKR']);
  await db.run(`INSERT INTO compensation (employee_id, basic_salary, currency) VALUES (?, ?, ?)`, [mgrId, 250000, 'PKR']);
  await db.run(`INSERT INTO compensation (employee_id, basic_salary, currency) VALUES (?, ?, ?)`, [hrAdminId, 220000, 'PKR']);
  await db.run(`INSERT INTO compensation (employee_id, stipend_amount, currency) VALUES (?, ?, ?)`, [internId, 30000, 'PKR']);
  await db.run(`INSERT INTO compensation (employee_id, contractor_rate, currency) VALUES (?, ?, ?)`, [contractorId, 1500, 'PKR']);

  const pw = hash('Password123!');
  const users = [
    ['ayesha.khan@agency.local', 'SystemAdmin', ceoId],
    ['bilal.ahmed@agency.local', 'HRAdmin', hrAdminId],
    ['sara.malik@agency.local', 'Manager', mgrId],
    ['usman.tariq@agency.local', 'Employee', fullTimeId],
    ['fatima.zahra@agency.local', 'Employee', fullTime2Id],
    ['hamza.raza@agency.local', 'SystemAdmin', sysAdminEmpId],
    ['zainab.iqbal@agency.local', 'FinanceOfficer', financeEmpId],
    ['ali.raza@agency.local', 'Employee', internId],
    ['omar.farooq@agency.local', 'Employee', contractorId]
  ];
  for (const [email, role, empId] of users) {
    await db.run('INSERT INTO users (email, password_hash, role, employee_id) VALUES (?, ?, ?, ?)', [email, pw, role, empId]);
  }

  const skillIds = {};
  for (const s of ['SEO', 'Copywriting', 'Paid Ads', 'Video Editing', 'Graphic Design', 'Content Strategy']) {
    const info = await db.run('INSERT INTO skills (name) VALUES (?)', [s]);
    skillIds[s] = info.id;
  }
  async function tagSkill(empId, skillName) {
    await db.run('INSERT INTO employee_skills (employee_id, skill_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [empId, skillIds[skillName]]);
  }
  await tagSkill(fullTime2Id, 'SEO');
  await tagSkill(fullTimeId, 'Content Strategy');
  await tagSkill(contractorId, 'Copywriting');
  await tagSkill(internId, 'Paid Ads');

  const clientInfo = await db.run('INSERT INTO clients (name, contact_info) VALUES (?, ?)', ['Northline Retail Co.', 'contact@northline.example']);
  const client2Info = await db.run('INSERT INTO clients (name, contact_info) VALUES (?, ?)', ['GreenLeaf NGO', 'info@greenleaf.example']);

  const projectInfo = await db.run(`
    INSERT INTO projects (name, client_id, donor, location, funding_source, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ['Northline Q3 Social Campaign', clientInfo.id, null, 'Lahore', 'Client-funded', '2026-07-01', '2026-09-30', 'Active']);

  const project2Info = await db.run(`
    INSERT INTO projects (name, client_id, donor, location, funding_source, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ['GreenLeaf Awareness Program', client2Info.id, 'USAID', 'Punjab', 'Donor-funded', '2026-05-01', '2026-12-31', 'Active']);

  await db.run('INSERT INTO project_assignments (project_id, employee_id, role_on_project, start_date, is_volunteer) VALUES (?, ?, ?, ?, false)',
    [projectInfo.id, fullTimeId, 'Content Lead', '2026-07-01']);
  await db.run('INSERT INTO project_assignments (project_id, employee_id, role_on_project, start_date, is_volunteer) VALUES (?, ?, ?, ?, false)',
    [projectInfo.id, fullTime2Id, 'SEO Support', '2026-07-01']);
  await db.run('INSERT INTO project_assignments (project_id, employee_id, role_on_project, start_date, is_volunteer) VALUES (?, ?, ?, ?, false)',
    [projectInfo.id, contractorId, 'Copywriter', '2026-07-01']);
  await db.run('INSERT INTO project_assignments (project_id, employee_id, role_on_project, start_date, is_volunteer) VALUES (?, ?, ?, ?, false)',
    [project2Info.id, internId, 'Campaign Assistant', '2026-06-01']);

  await db.run('INSERT INTO time_logs (employee_id, project_id, date, hours, billable, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [fullTimeId, projectInfo.id, '2026-08-20', 6, true, 'Content calendar planning']);
  await db.run('INSERT INTO time_logs (employee_id, project_id, date, hours, billable, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [fullTime2Id, projectInfo.id, '2026-08-20', 5, true, 'Keyword research']);
  await db.run('INSERT INTO time_logs (employee_id, project_id, date, hours, billable, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [contractorId, projectInfo.id, '2026-08-21', 4, true, 'Ad copy drafts']);
  await db.run('INSERT INTO time_logs (employee_id, project_id, date, hours, billable, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [internId, project2Info.id, '2026-08-21', 3, false, 'Internal training / onboarding']);

  const today = new Date();
  for (const offset of [0, 1, 2]) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const dateStr = d.toISOString().slice(0, 10);
    for (const eid of [fullTimeId, fullTime2Id, internId]) {
      try {
        await db.run('INSERT INTO attendance (employee_id, date, check_in, check_out, hours_worked, late_minutes) VALUES (?, ?, ?, ?, ?, ?)',
          [eid, dateStr, '09:05', '17:10', 8.08, 5]);
      } catch (e) { /* ignore duplicate */ }
    }
  }

  await db.run(`INSERT INTO work_calendar (date, day_type, description) VALUES (?, ?, ?)`, ['2026-08-14', 'Holiday', 'Independence Day']);

  await db.run('INSERT INTO policies (title, content) VALUES (?, ?)', [
    'Leave Policy', 'Full-time and part-time staff accrue leave monthly. Interns receive a flat allowance. Contractors are not eligible for paid leave under their invoice-based engagement.'
  ]);
  await db.run('INSERT INTO policies (title, content) VALUES (?, ?)', [
    'Code of Conduct', 'All staff, interns, and contractors are expected to maintain professionalism and confidentiality with client data.'
  ]);

  await db.run('INSERT INTO announcements (title, content, posted_by) VALUES (?, ?, ?)', [
    'Welcome to the new HRMS!', 'We have launched our new HR platform to manage attendance, leave, payroll, and projects in one place.', hrAdminId
  ]);

  const reqInfo = await db.run('INSERT INTO job_requisitions (title, department_id, description) VALUES (?, ?, ?)',
    ['Junior Graphic Designer', deptIds['Creative'], 'Support creative team with campaign visuals']);
  await db.run('INSERT INTO candidates (requisition_id, full_name, email, phone, stage) VALUES (?, ?, ?, ?, ?)',
    [reqInfo.id, 'Hina Yousaf', 'hina.yousaf@example.com', '+92-300-5551234', 'Applied']);

  const cycleInfo = await db.run('INSERT INTO review_cycles (name, cycle_type, start_date, end_date) VALUES (?, ?, ?, ?)',
    ['Q3 2026 Review', 'Quarterly', '2026-07-01', '2026-09-30']);
  await db.run('INSERT INTO goals (employee_id, cycle_id, title, description) VALUES (?, ?, ?, ?)',
    [fullTimeId, cycleInfo.id, 'Grow organic blog traffic by 20%', 'Focus on Q3 content calendar and SEO alignment']);

  console.log('Seed complete.');
  console.log('--------------------------------------------------');
  console.log('Demo login credentials (password for all: Password123!)');
  console.log('  SystemAdmin  : ayesha.khan@agency.local');
  console.log('  HRAdmin      : bilal.ahmed@agency.local');
  console.log('  Manager      : sara.malik@agency.local');
  console.log('  Employee(FT) : usman.tariq@agency.local');
  console.log('  FinanceOff.  : zainab.iqbal@agency.local');
  console.log('  Intern       : ali.raza@agency.local');
  console.log('  Contractor   : omar.farooq@agency.local');
  console.log('--------------------------------------------------');
}

module.exports = seed;

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
