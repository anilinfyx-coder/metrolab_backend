const { query } = require('./db');

async function run() {
  try {
    await query(`ALTER TABLE report_request_parameters ADD COLUMN IF NOT EXISTS b2b_client_id INT;`);
    console.log("Migration successful");
  } catch (err) {
    console.error("Migration failed:", err);
  }
  process.exit();
}

run();
