const { pool } = require('./db.js');
async function run() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS physical_examination_certificates (
                id SERIAL PRIMARY KEY,
                patient_id INTEGER REFERENCES patient(id) ON DELETE CASCADE,
                age VARCHAR(50),
                height VARCHAR(50),
                weight VARCHAR(50),
                bp VARCHAR(50),
                pulse VARCHAR(50),
                hearing_right VARCHAR(50),
                hearing_left VARCHAR(50),
                vision_right VARCHAR(50),
                vision_left VARCHAR(50),
                wear_glasses BOOLEAN DEFAULT false,
                eval_head VARCHAR(10),
                eval_nose VARCHAR(10),
                eval_mouth VARCHAR(10),
                eval_ears VARCHAR(10),
                eval_eyes VARCHAR(10),
                eval_lungs VARCHAR(10),
                eval_heart VARCHAR(10),
                eval_vascular VARCHAR(10),
                eval_abdomen VARCHAR(10),
                eval_spine VARCHAR(10),
                eval_skin VARCHAR(10),
                eval_neurologic VARCHAR(10),
                additional_comments TEXT,
                overall_condition VARCHAR(50),
                clinician_name VARCHAR(255),
                date_of_examination DATE,
                clinician_address TEXT,
                creation_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted BOOLEAN DEFAULT false,
                deleted_timestamp TIMESTAMP
            );
        `);
        console.log('Physical examination table created!');
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
