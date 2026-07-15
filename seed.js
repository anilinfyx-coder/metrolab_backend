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

    } catch (err) {
        console.error('❌ Failed to seed:', err.message);
    } finally {
        await pool.end();
    }
}

seedAll();
