// Run this once to initialize the database and create all tables
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_NAME = process.env.DB_NAME || 'metrolab';

// Step 1: Connect to default 'postgres' DB to create our database
async function createDatabase() {
    const adminPool = new Pool({
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: 'postgres', // connect to default db
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });

    try {
        // Check if database already exists
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

// Step 2: Connect to the new database and run the SQL schema
async function runMigration() {
    const pool = new Pool({
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: DB_NAME,
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });

    const sql = fs.readFileSync(path.join(__dirname, 'migrations', 'init.sql'), 'utf8');
    try {
        await pool.query(sql);
        console.log('✅ All tables created successfully!');
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
