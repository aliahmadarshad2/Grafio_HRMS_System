-- HRMS Database Schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS designations (
  id SERIAL PRIMARY KEY,
  title TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

-- ===== Module 1 & 11: Employee Management + Employment Type =====
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  emergency_contact TEXT,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  designation_id INTEGER REFERENCES designations(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('Full-time','Part-time','Contractor','Intern')),
  hire_date DATE,
  bank_details TEXT,
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active','Offboarded')),
  internship_start_date DATE,
  internship_end_date DATE,
  mentor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  university TEXT,
  course_program TEXT,
  institution_supervisor TEXT,
  contract_start_date DATE,
  contract_end_date DATE,
  engagement_scope TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Employee','Manager','HRAdmin','SystemAdmin','FinanceOfficer')),
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_skills (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, skill_id)
);

-- ===== Module 2: Attendance =====
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TEXT,
  check_out TEXT,
  hours_worked REAL,
  late_minutes INTEGER DEFAULT 0,
  overtime_minutes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Present' CHECK (status IN ('Present','Absent','Half-day','Corrected')),
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  requested_check_in TEXT,
  requested_check_out TEXT,
  reason TEXT,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_calendar (
  id SERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('Holiday','Weekend','WorkDay')),
  description TEXT
);

-- ===== Module 3: Leave Management =====
CREATE TABLE IF NOT EXISTS leave_policies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL,
  annual_days REAL DEFAULT 0,
  sick_days REAL DEFAULT 0,
  casual_days REAL DEFAULT 0,
  accrual_type TEXT DEFAULT 'monthly' CHECK (accrual_type IN ('monthly','yearly','flat','none'))
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL,
  balance REAL DEFAULT 0,
  UNIQUE(employee_id, leave_type)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days REAL NOT NULL,
  reason TEXT,
  attachment TEXT,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ===== Module 4/12: Projects, Clients, Assignments, Time Logs =====
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_info TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  donor TEXT,
  location TEXT,
  funding_source TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active','Completed','On-hold'))
);

CREATE TABLE IF NOT EXISTS project_assignments (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_on_project TEXT,
  start_date DATE,
  end_date DATE,
  is_volunteer BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS time_logs (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hours REAL NOT NULL,
  billable BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reimbursements (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Paid')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ===== Module 5: Recruitment =====
CREATE TABLE IF NOT EXISTS job_requisitions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  description TEXT,
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open','Closed','On-hold')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  requisition_id INTEGER NOT NULL REFERENCES job_requisitions(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  stage TEXT DEFAULT 'Applied' CHECK (stage IN ('Applied','Screened','Interviewed','Offered','Hired','Rejected')),
  interview_datetime TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ===== Module 6: Performance =====
CREATE TABLE IF NOT EXISTS review_cycles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cycle_type TEXT CHECK (cycle_type IN ('Quarterly','Annual','Internship')),
  start_date DATE,
  end_date DATE
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_id INTEGER REFERENCES review_cycles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'In-progress' CHECK (status IN ('Not-started','In-progress','Completed'))
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_id INTEGER REFERENCES review_cycles(id) ON DELETE SET NULL,
  self_assessment TEXT,
  manager_rating REAL,
  manager_feedback TEXT,
  is_internship_eval BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft','SelfSubmitted','Completed'))
);

-- ===== Module 7: ESS Tickets =====
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open','InProgress','Resolved','Closed')),
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ===== Module 8: Announcements & Notifications =====
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  posted_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  type TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ===== Payroll =====
CREATE TABLE IF NOT EXISTS payroll_runs (
  id SERIAL PRIMARY KEY,
  period_month INTEGER NOT NULL,
  period_year INTEGER NOT NULL,
  status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft','Processed','Paid')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id SERIAL PRIMARY KEY,
  payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('FullPayroll','InternStipend','ContractorInvoice')),
  basic_amount REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  net_amount REAL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS compensation (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary REAL,
  stipend_amount REAL,
  contractor_rate REAL,
  currency TEXT DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','InProgress','Completed')),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

