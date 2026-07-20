const { pool } = require('./db.js');
async function run() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS adult_health_certificates (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patient(id) ON DELETE CASCADE,
                free_from_disease BOOLEAN DEFAULT false,
                satisfactory_physical BOOLEAN DEFAULT false,
                tuberculin_test_type VARCHAR(50),
                tuberculin_date_planted DATE,
                tuberculin_date_read DATE,
                tuberculin_result VARCHAR(255),
                chest_xray_date DATE,
                chest_xray_result VARCHAR(255),
                additional_info TEXT,
                clinician_name VARCHAR(255),
                date_of_examination DATE,
                clinician_address TEXT,
                creation_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted BOOLEAN DEFAULT false,
                deleted_timestamp TIMESTAMP
            );
        `);
        console.log('Table created!');
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
