const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const MIGRATE_SQL_PATH = path.join(__dirname, '..', 'migrations', 'migrate.sql');

/**
 * Runs incremental / idempotent SQL from migrations/migrate.sql.
 * Safe to call on every backend start (uses IF NOT EXISTS / ON CONFLICT).
 */
async function runStartupMigrations() {
    if (!fs.existsSync(MIGRATE_SQL_PATH)) {
        console.warn('⚠️  migrations/migrate.sql not found — skipping startup migrations.');
        return;
    }

    const sql = fs.readFileSync(MIGRATE_SQL_PATH, 'utf8');
    if (!String(sql).trim()) {
        console.warn('⚠️  migrations/migrate.sql is empty — skipping.');
        return;
    }

    console.log('🔄 Running database migrations...');
    await pool.query(sql);
    console.log('✅ Database migrations applied.');
}

module.exports = { runStartupMigrations };
