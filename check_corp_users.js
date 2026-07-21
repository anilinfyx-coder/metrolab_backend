const { pool } = require('./db');

async function check() {
  try {
    const { rows } = await pool.query('SELECT * FROM corporate_clients WHERE email = \'anil.infyx@gmail.com\'');
    console.log(rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
check();
