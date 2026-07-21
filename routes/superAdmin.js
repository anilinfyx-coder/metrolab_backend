const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { validateLoginUser, isMainSuperAdmin } = require('../utils/loginAuth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── POST /api/SuperAdmin/login ────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await queryOne(
            `SELECT * FROM super_admin WHERE email = $1 AND deleted = false LIMIT 1`,
            [username]
        );
        const auth = await validateLoginUser(user, password);
        if (!auth.ok) return resp(res, auth.code, auth.message);

        const token = jwt.sign(
            { id: auth.user.id, email: auth.user.email, role_id: auth.user.role_id, role_type_id: auth.user.role_type_id, portal: 'superadmin' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: auth.user.id, name: auth.user.name, email: auth.user.email,
            mobile: auth.user.mobile, role: auth.user.role_id, portal: 'superadmin', token
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── Dashboard & Profile Routes (Protected) ───────────────────
router.use(authMiddleware);

router.get('/dashboardStats', async (req, res) => {
    try {
        const stats = await queryOne(`
            SELECT 
                (SELECT COUNT(*) FROM super_admin WHERE deleted = false) as staff,
                (SELECT COUNT(*) FROM b2b_clients WHERE deleted = false) as b2b,
                (SELECT COUNT(*) FROM corporate_clients WHERE deleted = false) as corporate,
                (SELECT COUNT(*) FROM lab_tests WHERE deleted = false) as labs,
                (SELECT COUNT(*) FROM patient WHERE deleted = false) as patients
        `);
        
        return resp(res, '200', {
            total_staff: parseInt(stats.staff, 10),
            total_b2b_clients: parseInt(stats.b2b, 10),
            total_corporate_clients: parseInt(stats.corporate, 10),
            total_lab_tests: parseInt(stats.labs, 10),
            total_patients: parseInt(stats.patients, 10)
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

router.post('/getProfile', async (req, res) => {
    try {
        const userId = req.body.id || req.user.id;
        const user = await queryOne(
            `SELECT id, name, email, mobile, role_id, status FROM super_admin WHERE id = $1 AND deleted = false LIMIT 1`,
            [userId]
        );
        if (!user) return resp(res, '404', 'User not found');
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.post('/updateProfile', async (req, res) => {
    try {
        const { name, email, mobile } = req.body;
        const userId = req.user.id;
        await queryOne(
            `UPDATE super_admin SET name = $1, email = $2, mobile = $3 WHERE id = $4`,
            [name, email, mobile, userId]
        );
        return resp(res, '200', 'Profile Updated Successfully');
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.post('/changePassword', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;
        
        const user = await queryOne(`SELECT password FROM super_admin WHERE id = $1 LIMIT 1`, [userId]);
        if (!user) return resp(res, '404', 'User not found');
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return resp(res, '400', 'Current password is incorrect');
        
        const hashed = await bcrypt.hash(newPassword, 10);
        await queryOne(`UPDATE super_admin SET password = $1 WHERE id = $2`, [hashed, userId]);
        
        return resp(res, '200', 'Password Changed Successfully');
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/SuperAdmin ──────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted
             FROM super_admin WHERE deleted = false ORDER BY id DESC`
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/SuperAdmin/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const user = await queryOne(
            `SELECT id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted
             FROM super_admin WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!user) return resp(res, '404', 'Super Admin not found');
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/SuperAdmin ─────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { name, email, mobile, password, role_id, role_type_id, uid, image_file, user_id } = req.body;
        const hashed = await bcrypt.hash(password, 10);
        const user = await queryOne(
            `INSERT INTO super_admin (name, email, mobile, password, role_id, role_type_id, uid, image_file, user_id, status, deleted, creation_timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,NOW()) RETURNING *`,
            [name, email, mobile, hashed, role_id, role_type_id, uid, image_file, user_id]
        );
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── PUT /api/SuperAdmin/:id ──────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const existing = await queryOne(
            `SELECT id, role_id FROM super_admin WHERE id = $1 AND deleted = false LIMIT 1`,
            [req.params.id]
        );
        if (!existing) return resp(res, '404', 'Super Admin not found');

        if (isMainSuperAdmin(existing) && req.body.status === false) {
            return resp(res, '400', 'Main Super Admin account cannot be disabled.');
        }

        const { name, email, mobile, password, role_id, status } = req.body;
        let setClause = 'name = COALESCE($1, name), email = COALESCE($2, email), mobile = COALESCE($3, mobile), role_id = COALESCE($4, role_id), status = COALESCE($5, status)';
        const values = [name, email, mobile, role_id, status];
        let index = 6;
        if (password) {
            setClause += `, password = $${index++}`;
            values.push(await bcrypt.hash(password, 10));
        }
        values.push(req.params.id);
        
        const row = await queryOne(
            `UPDATE super_admin SET ${setClause} WHERE id = $${index} RETURNING *`,
            values
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── DELETE /api/SuperAdmin/:id ───────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `UPDATE super_admin SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
