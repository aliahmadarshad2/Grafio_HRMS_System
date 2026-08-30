const jwt = require('jsonwebtoken');
const db = require('../db/pg');

const JWT_SECRET = process.env.JWT_SECRET || 'hrms-dev-secret-change-in-prod';

function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, role, employee_id }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires role(s) ${allowedRoles.join(', ')}` });
    }
    next();
  };
}

async function logAudit(userId, action, entity, entityId, details) {
  try {
    await db.run(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
      [userId, action, entity, entityId || null, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

module.exports = { authenticate, authorize, logAudit, JWT_SECRET };
