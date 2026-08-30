const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL environment variable is not set.');
}

const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// Convert '?' positional placeholders (SQLite-style) to '$1, $2, ...' (Postgres-style)
// so route code can stay close to the original query style.
function toPgQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const res = await pool.query(toPgQuery(sql), params);
  return res.rows;
}

async function get(sql, params = []) {
  const res = await pool.query(toPgQuery(sql), params);
  return res.rows[0];
}

// For INSERT/UPDATE/DELETE. If the SQL is an INSERT without RETURNING, this
// automatically appends "RETURNING id" so callers can read `.id` back,
// mirroring better-sqlite3's `lastInsertRowid`.
async function run(sql, params = []) {
  let finalSql = sql.trim();
  const isInsert = /^insert/i.test(finalSql);
  const alreadyHasReturning = /returning/i.test(finalSql);
  if (isInsert && !alreadyHasReturning) {
    finalSql += ' RETURNING id';
  }
  try {
    const res = await pool.query(toPgQuery(finalSql), params);
    return {
      id: res.rows[0] ? res.rows[0].id : undefined,
      rowCount: res.rowCount,
      rows: res.rows
    };
  } catch (e) {
    // Some tables (e.g. join tables with composite primary keys) have no
    // `id` column — retry without the auto-appended RETURNING clause.
    if (isInsert && !alreadyHasReturning && e.code === '42703') {
      const withoutReturning = sql.trim();
      const res = await pool.query(toPgQuery(withoutReturning), params);
      return { id: undefined, rowCount: res.rowCount, rows: res.rows };
    }
    throw e;
  }
}

let schemaReady = null;
async function ensureSchema() {
  if (!schemaReady) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    schemaReady = pool.query(schema);
  }
  return schemaReady;
}

module.exports = { pool, all, get, run, ensureSchema };
