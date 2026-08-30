# HRMS — Agency Edition (Vercel + Postgres)

Full-stack HR Management System, rebuilt to run on Vercel's serverless platform with a Postgres database (works with any free, no-card Postgres provider — Neon or Supabase recommended).

## What's new in this version

- **Full CRUD everywhere.** Every entity — employees, departments, designations, locations, skills, leave policies, projects, clients, job requisitions, candidates, review cycles, goals, announcements, policies, tickets, time logs, reimbursements, user accounts — now supports create, edit, and delete from the UI, scoped to what each role is allowed to touch.
- **New tabs:** Recruitment (requisitions → candidates → hire pipeline), Performance (review cycles, goals, self-assessments, manager ratings, intern evaluations), Settings (departments/designations/locations/skills/leave-policy management + audit log), Users (SystemAdmin-only account management), and an HR Desk tab combining tickets, announcements, and the policy handbook.
- **Postgres instead of SQLite**, so it works properly on Vercel's stateless serverless functions (SQLite's single-file model doesn't survive serverless cold starts).
- **Hard delete for employees** (SystemAdmin only) cascades cleanly to all dependent records (attendance, leave, payroll history, project assignments, etc.) via foreign-key `ON DELETE CASCADE`/`SET NULL` rules — no orphaned rows.
- Self-delete protection on user accounts, ownership checks on personal records (you can only edit/delete your own time logs, tickets, leave requests, etc. unless you're HR/Admin).

## Project structure

```
api/index.js       → Vercel serverless function entry (exports the Express app)
src/app.js         → Express app (routes, middleware, schema/seed bootstrap)
src/db/pg.js        → Postgres connection pool + query helpers
src/db/schema.sql   → Full schema with proper cascade rules
src/db/seed.js      → Idempotent seed (only runs if the employees table is empty)
src/routes/*.js     → One file per module (employees, leave, projects, payroll, etc.)
src/middleware/auth.js → JWT auth + role-based access control + audit logging
public/index.html   → Frontend (single-page app, vanilla JS + Tailwind CDN)
server.js           → Local dev server only (not used on Vercel)
vercel.json          → Routes all /api/* requests to the serverless function
```

## Deploying to Vercel (free, no credit card)

### Step 1 — Get a free Postgres database

Vercel's serverless functions can't use a local SQLite file, so you need a real database reachable over the network. Both of these are genuinely free with no card required:

**Option A: Neon** (neon.tech)
1. Sign up with GitHub.
2. Create a project → it gives you a connection string immediately, e.g. `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`.
3. Copy that connection string — you'll need it in Step 3.

**Option B: Supabase** (supabase.com)
1. Sign up with GitHub → New Project.
2. Go to Project Settings → Database → copy the "Connection string" (URI format, use the "Transaction" pooler mode for serverless).

Either works — just grab the connection string.

### Step 2 — Push this project to GitHub

Create a new repo (e.g. `hrms-agency-system`) and push everything in this zip to it.

### Step 3 — Import into Vercel

1. Go to vercel.com → sign up with GitHub (no card required for the Hobby plan).
2. **Add New... → Project** → select your repo → Import.
3. Vercel auto-detects the Node.js setup. Before deploying, expand **Environment Variables** and add:
   - `DATABASE_URL` — the connection string from Step 1
   - `JWT_SECRET` — any long random string (e.g. generate one at randomkeygen.com)
4. Click **Deploy**. Takes about a minute.

### Step 4 — Open it

Vercel gives you a URL like `https://hrms-agency-system.vercel.app`. Open it — the app creates its schema and seeds demo data automatically on the very first request, so you can log in immediately.

## Demo accounts (password for all: `Password123!`)

| Role | Email |
|---|---|
| SystemAdmin | ayesha.khan@agency.local |
| HRAdmin | bilal.ahmed@agency.local |
| Manager | sara.malik@agency.local |
| Employee (Full-time) | usman.tariq@agency.local |
| Employee (Full-time) | fatima.zahra@agency.local |
| FinanceOfficer | zainab.iqbal@agency.local |
| Intern | ali.raza@agency.local |
| Contractor | omar.farooq@agency.local |

## Why this setup has no free-tier data-loss problem

Unlike the earlier Render/Zeabur/SQLite approach, this version's data lives in a real Postgres database (Neon/Supabase), completely separate from Vercel's compute. Vercel's serverless functions can spin down and back up freely — your data just sits in the database the whole time, unaffected. Neon's and Supabase's free tiers do pause the *database itself* after a period of total inactivity, but it wakes automatically on the next query (a few seconds of delay), and the data is never lost.

## Local development

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL (a local Postgres instance) and JWT_SECRET
npm run seed            # optional — server.js seeds automatically on first run too
node server.js
```

Open `http://localhost:3000`.

## Role permissions at a glance

| Entity | Create | Edit | Delete |
|---|---|---|---|
| Employees | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin (own contact info: self) | SystemAdmin only (hard delete) |
| Departments/Designations/Locations/Skills | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin |
| Leave Policies | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin |
| Leave Requests | Any employee (own) | Manager/HR approve | Owner (if still Pending), HR/SystemAdmin |
| Projects/Clients | Manager, HRAdmin, SystemAdmin | Manager, HRAdmin, SystemAdmin | HRAdmin, SystemAdmin |
| Time Logs | Any employee (own) | Owner, HR/SystemAdmin | Owner, HR/SystemAdmin |
| Reimbursements | Any employee (own) | FinanceOfficer, HR, SystemAdmin (status) | Owner (if Pending), Finance/HR/SystemAdmin |
| Job Requisitions/Candidates | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin |
| Review Cycles | Manager, HRAdmin, SystemAdmin | Manager, HRAdmin, SystemAdmin | HRAdmin, SystemAdmin |
| Goals | Manager, HRAdmin, SystemAdmin | Owner (status), Manager/HR (all fields) | Manager, HRAdmin, SystemAdmin |
| Announcements/Policies (handbook) | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin | HRAdmin, SystemAdmin |
| Tickets | Any employee (own) | HR (resolve) | Owner (if Open), HR/SystemAdmin |
| User Accounts | SystemAdmin | SystemAdmin | SystemAdmin (not own account) |

## Notes & simplifications

- Payroll tax logic is a simplified 10% placeholder — replace with real local tax rules before production use.
- File uploads (documents, leave attachments) are recorded as filename/metadata only; wire up real storage (e.g. Vercel Blob, S3) for production.
- "Auto" processes (leave accrual, internship-expiry offboarding, reminder generation) are exposed as HR Admin-triggered endpoints; wire these to Vercel Cron (free, built-in) for true scheduling.
- Biometric device integration, SSO, and SMS notifications are out of scope but the schema/check-in endpoints are structured to accept an external feed later.
