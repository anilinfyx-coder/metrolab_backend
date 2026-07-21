require('dotenv').config();
const { pool } = require('./db');

async function migrate() {
    try {
        console.log('Creating b2b_client_custom_prices table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS b2b_client_custom_prices (
                id SERIAL PRIMARY KEY,
                b2b_client_id INTEGER REFERENCES b2b_clients(id),
                lab_test_id INTEGER REFERENCES lab_tests(id),
                custom_price NUMERIC NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(b2b_client_id, lab_test_id)
            );
        `);
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
