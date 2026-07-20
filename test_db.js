const { pool } = require('./db.js');
pool.query("SELECT id, uid, name FROM patient WHERE name IN ('anil', 'harsh')")
  .then(res => { console.log(res.rows); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
