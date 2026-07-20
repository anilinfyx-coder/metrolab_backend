const { pool } = require('./db.js');
async function run() {
  try {
    const res = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'patient';
    `);
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
