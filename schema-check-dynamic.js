const { pool } = require('./db');

async function run() {
    try {
        const tableName = process.argv[2];
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [tableName]);
        console.log(`Columns for ${tableName}:`, res.rows.map(r => r.column_name));
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
