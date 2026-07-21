require('dotenv').config();
const { Pool } = require('pg');
const { getPoolConfig } = require('./dbConfig');

const pool = new Pool(getPoolConfig());

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
