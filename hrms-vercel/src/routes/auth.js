const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/pg');
const { authenticate, authorize, logAudit, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await db.get('SELECT * FROM users WHERE email = ? AND is_active = true', [email]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, employee_id: user.employee_id },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  await logAudit(user.id, 'LOGIN', 'users', user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, employee_id: user.employee_id }
  });
});

router.get('/me', authenticate, async (req, res) => {
  const employee = req.user.employee_id
    ? await db.get('SELECT * FROM employees WHERE id = ?', [req.user.employee_id])
    : null;
  res.json({ user: req.user, employee });
});

router.post('/users', authenticate, authorize('SystemAdmin'), async (req, res) => {
  const { email, password, role, employee_id } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role required' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = await db.run(
      `INSERT INTO users (email, password_hash, role, employee_id) VALUES (?, ?, ?, ?)`,
      [email, hash, role, employee_id || null]
    );
    await logAudit(req.user.id, 'CREATE_USER', 'users', info.id, { email, role });
    res.status(201).json({ id: info.id, email, role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/users', authenticate, authorize('SystemAdmin'), async (req, res) => {
  const users = await db.all('SELECT id, email, role, employee_id, is_active, created_at FROM users');
  res.json(users);
});

router.put('/users/:id', authenticate, authorize('SystemAdmin'), async (req, res) => {
  const { role, is_active } = req.body;
  const existing = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  await db.run('UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?',
    [role || null, is_active === undefined ? null : is_active, req.params.id]);
  await logAudit(req.user.id, 'UPDATE_USER', 'users', req.params.id, { role, is_active });
  res.json({ success: true });
});

router.delete('/users/:id', authenticate, authorize('SystemAdmin'), async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) {
    return res.status(400).json({ error: "You can't delete your own account while logged in as it" });
  }
  const existing = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'DELETE_USER', 'users', req.params.id, { email: existing.email });
  res.json({ success: true });
});

module.exports = router;
