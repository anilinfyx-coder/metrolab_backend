const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const MIGRATE_SQL_PATH = path.join(__dirname, '..', 'migrations', 'migrate.sql');

/**
 * Split migrate.sql into individual statements.
 * Ignores empty chunks and comment-only chunks.
 */
function splitSqlStatements(sql) {
    const parts = String(sql).split(';');
    const statements = [];
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const withoutComments = trimmed
            .split('\n')
            .filter((line) => {
                const t = line.trim();
                return t && !t.startsWith('--');
            })
            .join('\n')
            .trim();
        if (withoutComments) statements.push(withoutComments);
    }
    return statements;
}

/**
 * Runs incremental / idempotent SQL from migrations/migrate.sql.
 * Each statement is committed separately so one failure cannot roll back earlier adds
 * (e.g. custom_domain must still apply even if a later ALTER fails).
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

    const statements = splitSqlStatements(sql);
    console.log(`🔄 Running database migrations (${statements.length} statements)...`);

    let applied = 0;
    let failed = 0;
    for (const statement of statements) {
        try {
            await pool.query(statement);
            applied += 1;
        } catch (err) {
            failed += 1;
            const preview = statement.replace(/\s+/g, ' ').slice(0, 140);
            console.error(`⚠️  Migration statement failed: ${err.message}`);
            console.error(`   SQL: ${preview}${statement.length > 140 ? '…' : ''}`);
        }
    }

    if (failed > 0) {
        console.warn(`⚠️  Migrations finished with ${failed} failed / ${applied} applied.`);
    } else {
        console.log(`✅ Database migrations applied (${applied} statements).`);
    }
}

module.exports = { runStartupMigrations };
