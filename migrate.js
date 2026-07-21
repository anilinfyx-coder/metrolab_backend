// Run this once to initialize the database and create all tables
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { getPoolConfig, isManagedDatabase } = require('./dbConfig');

const DB_NAME = process.env.DB_NAME || 'metrolab';

async function createDatabase() {
    if (isManagedDatabase()) {
        console.log('ℹ️  Using managed database (DB_URL) — skipping CREATE DATABASE.');
        return;
    }

    const adminPool = new Pool(
        getPoolConfig({
            database: 'postgres',
            connectionTimeoutMillis: 2000,
        })
    );

    try {
        const result = await adminPool.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
        );
        if (result.rowCount === 0) {
            await adminPool.query(`CREATE DATABASE "${DB_NAME}"`);
            console.log(`✅ Database "${DB_NAME}" created!`);
        } else {
            console.log(`ℹ️  Database "${DB_NAME}" already exists.`);
        }
    } finally {
        await adminPool.end();
    }
}

async function runMigration() {
    const pool = new Pool(getPoolConfig());

    try {
        const initSql = fs.readFileSync(path.join(__dirname, 'migrations', 'init.sql'), 'utf8');
        await pool.query(initSql);
        console.log('✅ All tables created successfully!');

        const migrateSqlPath = path.join(__dirname, 'migrations', 'migrate.sql');
        if (fs.existsSync(migrateSqlPath)) {
            const migrateSql = fs.readFileSync(migrateSqlPath, 'utf8');
            await pool.query(migrateSql);
            console.log('✅ Incremental migrations applied (migrate.sql)!');
        }
    } finally {
        await pool.end();
    }
}

async function main() {
    console.log('🔄 Starting Metrolab database setup...');
    try {
        await createDatabase();
        await runMigration();
        console.log('\n🎉 Database ready! You can now run: npm run dev');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
}

main();
