const { pool } = require('./db.js');
async function run() {
  try {
    const maxId = await pool.query('SELECT MAX(id) FROM patient;');
    const seqVal = await pool.query("SELECT nextval('patient_id_seq');");
    console.log('Max ID:', maxId.rows[0].max, 'Next Seq:', seqVal.rows[0].nextval);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
