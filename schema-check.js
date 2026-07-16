const { pool } = require('./db');

async function run() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'b2b_client_document'");
        console.log('b2b_client_document columns:', res.rows.map(r => r.column_name));
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
