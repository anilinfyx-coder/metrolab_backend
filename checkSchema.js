const { pool } = require('./db');

pool.query(`
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'patient' 
  AND column_name IN ('driving_license', 'ssn', 'dob')
`).then(res => {
  console.table(res.rows);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
