const { pool } = require('./db.js');
async function run() {
  try {
    await pool.query("SELECT setval('patient_id_seq', (SELECT MAX(id) FROM patient));");
    console.log('Sequence updated successfully!');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
