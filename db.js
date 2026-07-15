require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'metrolab',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle postgres client', err);
});

// Helper: run a query and return rows
const query = (text, params) => pool.query(text, params);

// Helper: run a query and return first row
const queryOne = async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows[0] || null;
};

module.exports = { pool, query, queryOne };
