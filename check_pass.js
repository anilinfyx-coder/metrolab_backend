const { pool } = require('./db.js');
async function run() {
  try {
    const res = await pool.query(`
      SELECT p.name, p.dob, c.id, 'adult' as type 
      FROM adult_health_certificates c JOIN patient p ON c.patient_id = p.id 
      WHERE p.dob IS NOT NULL ORDER BY c.id DESC LIMIT 5
    `);
    const res2 = await pool.query(`
      SELECT p.name, p.dob, c.id, 'physical' as type 
      FROM physical_examination_certificates c JOIN patient p ON c.patient_id = p.id 
      WHERE p.dob IS NOT NULL ORDER BY c.id DESC LIMIT 5
    `);
    
    const rows = [...res.rows, ...res2.rows];
    
    rows.forEach(r => {
      let m, day;
      if (typeof r.dob === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.dob)) {
          const parts = r.dob.slice(0, 10).split('-');
          m = Number(parts[1]);
          day = Number(parts[2]);
      } else {
          const d = new Date(r.dob);
          if (Number.isNaN(d.getTime())) return;
          m = d.getUTCMonth() + 1;
          day = d.getUTCDate();
      }
      const pad = n => String(n).padStart(2, '0');
      console.log(`[${r.type.toUpperCase()}] Cert #${r.id} | Patient: ${r.name} | DOB: ${r.dob} | Password: ${pad(m)}${pad(day)}`);
    });
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
