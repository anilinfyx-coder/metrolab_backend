require('dotenv').config();
const { pool } = require('./db');

async function seedGeo() {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM country WHERE deleted = false`);
    if (rows[0].c > 0) {
      console.log('Geo data already present:', rows[0].c, 'countries');
      return;
    }

    const usa = await pool.query(
      `INSERT INTO country (name, acronym, status, deleted) VALUES ('USA', 'US', true, false) RETURNING id`
    );
    const india = await pool.query(
      `INSERT INTO country (name, acronym, status, deleted) VALUES ('India', 'IN', true, false) RETURNING id`
    );
    const canada = await pool.query(
      `INSERT INTO country (name, acronym, status, deleted) VALUES ('Canada', 'CA', true, false) RETURNING id`
    );

    const usaId = usa.rows[0].id;
    const inId = india.rows[0].id;
    const caId = canada.rows[0].id;

    const ca = await pool.query(
      `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('California', 'CA', $1, true, false) RETURNING id`,
      [usaId]
    );
    const ny = await pool.query(
      `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('New York', 'NY', $1, true, false) RETURNING id`,
      [usaId]
    );
    const tx = await pool.query(
      `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('Texas', 'TX', $1, true, false) RETURNING id`,
      [usaId]
    );
    const gj = await pool.query(
      `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('Gujarat', 'GJ', $1, true, false) RETURNING id`,
      [inId]
    );
    const on = await pool.query(
      `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('Ontario', 'ON', $1, true, false) RETURNING id`,
      [caId]
    );

    await pool.query(
      `INSERT INTO city (name, country_id, state_id, status, deleted) VALUES
        ('Los Angeles', $1, $2, true, false),
        ('San Francisco', $1, $2, true, false),
        ('New York City', $1, $3, true, false),
        ('Houston', $1, $4, true, false),
        ('Ahmedabad', $5, $6, true, false),
        ('Surat', $5, $6, true, false),
        ('Toronto', $7, $8, true, false)`,
      [usaId, ca.rows[0].id, ny.rows[0].id, tx.rows[0].id, inId, gj.rows[0].id, caId, on.rows[0].id]
    );

    console.log('✅ Geo data seeded');
  } catch (err) {
    console.error('❌ Geo seed failed:', err.message);
  } finally {
    await pool.end();
  }
}

seedGeo();
