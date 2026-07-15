const { pool } = require('./db');

async function run() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'lab_tests' AND column_name LIKE 'show_%'");
        console.log('UI Flags in lab_tests:', res.rows.map(r => r.column_name));
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
