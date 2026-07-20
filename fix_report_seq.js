const { pool } = require('./db.js');
async function run() {
  try {
    await pool.query("SELECT setval('lab_test_category_report_id_seq', (SELECT MAX(id) FROM lab_test_category_report));");
    console.log('Sequence lab_test_category_report_id_seq updated successfully!');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
