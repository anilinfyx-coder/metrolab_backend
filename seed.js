require('dotenv').config();
const { pool } = require('./db');
const bcrypt = require('bcryptjs');

async function seedAll() {
    console.log('🌱 Seeding Default Users...');
    const hashed = await bcrypt.hash('admin@123', 10);
    
    try {
        // Clear existing test users to prevent duplicates
        await pool.query(`DELETE FROM corporate_clients WHERE email = 'corporate@metrolab.com'`);
        await pool.query(`DELETE FROM b2b_clients WHERE email = 'b2b@metrolab.com'`);
        await pool.query(`DELETE FROM super_admin WHERE email = 'superadmin@metrolab.com'`);
        await pool.query(`DELETE FROM admin_users WHERE email = 'admin@metrolab.com'`);

        // 1. Admin User
        await pool.query(
            `INSERT INTO admin_users (name, email, password, role_id, role_type_id, status, deleted)
             VALUES ($1, $2, $3, $4, $5, true, false)`,
            ['Admin User', 'admin@metrolab.com', hashed, 1, 1]
        );
        console.log('✅ Admin user created: admin@metrolab.com / admin@123');

        // 2. Super Admin
        await pool.query(
            `INSERT INTO super_admin (name, email, password, role_id, role_type_id, status, deleted)
             VALUES ($1, $2, $3, $4, $5, true, false)`,
            ['Super Admin', 'superadmin@metrolab.com', hashed, 1, 1]
        );
        console.log('✅ Super Admin created: superadmin@metrolab.com / admin@123');

        // 3. B2B Client
        const b2bRes = await pool.query(
            `INSERT INTO b2b_clients (company_name, email, password, status, deleted)
             VALUES ($1, $2, $3, true, false) RETURNING id`,
            ['B2B Partner Clinic', 'b2b@metrolab.com', hashed]
        );
        const b2bId = b2bRes.rows[0].id;
        console.log('✅ B2B Client created: b2b@metrolab.com / admin@123');

        // 4. Corporate Client
        await pool.query(
            `INSERT INTO corporate_clients (company_name, email, password, b2b_client_id, status, deleted)
             VALUES ($1, $2, $3, $4, true, false)`,
            ['Corporate Partner', 'corporate@metrolab.com', hashed, b2bId]
        );
        console.log('✅ Corporate Client created: corporate@metrolab.com / admin@123');

        // 5. Geo master data (Country / State / City) if empty
        const { rows: countryCount } = await pool.query(`SELECT COUNT(*)::int AS c FROM country WHERE deleted = false`);
        if (countryCount[0].c === 0) {
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

            const caState = await pool.query(
                `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('California', 'CA', $1, true, false) RETURNING id`,
                [usaId]
            );
            const nyState = await pool.query(
                `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('New York', 'NY', $1, true, false) RETURNING id`,
                [usaId]
            );
            const txState = await pool.query(
                `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('Texas', 'TX', $1, true, false) RETURNING id`,
                [usaId]
            );
            const gjState = await pool.query(
                `INSERT INTO state (name, acronym, country_id, status, deleted) VALUES ('Gujarat', 'GJ', $1, true, false) RETURNING id`,
                [inId]
            );
            const onState = await pool.query(
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
                [usaId, caState.rows[0].id, nyState.rows[0].id, txState.rows[0].id, inId, gjState.rows[0].id, caId, onState.rows[0].id]
            );
            console.log('✅ Geo data seeded (USA / India / Canada + sample states & cities)');
        } else {
            console.log('ℹ️ Geo data already present, skipping');
        }

    } catch (err) {
        console.error('❌ Failed to seed:', err.message);
    } finally {
        await pool.end();
    }
}

seedAll();
