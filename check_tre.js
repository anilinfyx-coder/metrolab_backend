const {pool} = require('./db.js');
pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1', ['test_request_employee'])
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(()=>process.exit(0));
