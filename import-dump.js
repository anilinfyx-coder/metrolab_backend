#!/usr/bin/env node
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dumpPath = path.resolve(__dirname, '..', 'metrolab_18_juy.sql');
const dbUrl = process.env.DB_URL;
const resumeOnly = process.argv.includes('--resume');

if (!dbUrl) {
    console.error('❌ DB_URL is not set in .env');
    process.exit(1);
}

if (!fs.existsSync(dumpPath)) {
    console.error(`❌ Dump file not found: ${dumpPath}`);
    process.exit(1);
}

const pgRestoreCandidates = [
    process.env.PG_RESTORE,
    '/opt/homebrew/opt/postgresql@18/bin/pg_restore',
    '/opt/homebrew/opt/postgresql@17/bin/pg_restore',
    '/usr/local/opt/postgresql@18/bin/pg_restore',
    'pg_restore',
].filter(Boolean);

const pgRestore = pgRestoreCandidates.find((candidate) => {
    if (candidate.includes('/')) {
        return fs.existsSync(candidate);
    }
    return spawnSync('which', [candidate], { encoding: 'utf8' }).status === 0;
});

if (!pgRestore) {
    console.error('❌ pg_restore not found. Install PostgreSQL 18 client tools first.');
    console.error('   brew install postgresql@18');
    process.exit(1);
}

function runPgRestore(args) {
    return spawnSync(pgRestore, args, { stdio: 'inherit', encoding: 'utf8' });
}

async function getEmptyTables() {
    const { Pool } = require('pg');
    const { getPoolConfig } = require('./dbConfig');
    const pool = new Pool(getPoolConfig());

    try {
        const tables = await pool.query(
            `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
        );
        const empty = [];

        for (const { tablename } of tables.rows) {
            const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tablename}`);
            if (result.rows[0].count === 0) {
                empty.push(tablename);
            }
        }

        return empty;
    } finally {
        await pool.end();
    }
}

async function importTable(tableName, dataOnly) {
    const args = [
        '--verbose',
        '--no-owner',
        '--no-acl',
        '-d',
        dbUrl,
        '-t',
        tableName,
    ];

    if (dataOnly) {
        args.push('--data-only', '--disable-triggers');
    } else {
        args.push('--clean', '--if-exists');
    }

    args.push(dumpPath);
    return runPgRestore(args);
}

async function restorePostData() {
    console.log('\n🔧 Restoring sequences, indexes, and constraints...');
    const result = runPgRestore([
        '--section=post-data',
        '--no-owner',
        '--no-acl',
        '-d',
        dbUrl,
        dumpPath,
    ]);

    if (result.status !== 0) {
        throw new Error('post-data restore failed');
    }
}

async function mainResume() {
    const emptyTables = await getEmptyTables();
    console.log(`📋 Importing data for ${emptyTables.length} empty table(s)...`);

    for (const tableName of emptyTables) {
        console.log(`\n➡️  Importing ${tableName}...`);
        const result = await importTable(tableName, true);
        if (result.status !== 0) {
            console.error(`\n❌ Import stopped at ${tableName}. Re-run: npm run import:dump:resume`);
            process.exit(1);
        }
    }

    console.log('\n✅ Dump imported successfully.');
    await restorePostData();
}

async function main() {
    console.log(`🔄 Importing dump into Neon using ${pgRestore}...`);
    console.log(`📦 Dump file: ${dumpPath}`);

    if (resumeOnly) {
        await mainResume();
        return;
    }

    const result = runPgRestore([
        '--verbose',
        '--no-owner',
        '--no-acl',
        '--clean',
        '--if-exists',
        '-d',
        dbUrl,
        dumpPath,
    ]);

    if (result.status !== 0) {
        console.error('\n⚠️  Full import failed. Retrying remaining tables...');
        await mainResume();
        return;
    }

    console.log('\n✅ Dump imported successfully.');
    await restorePostData();
}

main().catch((err) => {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
});
