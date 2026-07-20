require('dotenv').config();
const { pool } = require('./db');

async function migrate() {
    try {
        console.log('Adding is_fixed_price and fixed_price_amount to b2b_clients...');
        await pool.query('ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS is_fixed_price BOOLEAN DEFAULT false;');
        await pool.query('ALTER TABLE b2b_clients ADD COLUMN IF NOT EXISTS fixed_price_amount NUMERIC DEFAULT 0;');
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
