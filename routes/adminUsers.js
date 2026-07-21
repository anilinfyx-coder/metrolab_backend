const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { validateLoginUser } = require('../utils/loginAuth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── POST /api/AdminUsers/login ────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await queryOne(
            `SELECT * FROM admin_users WHERE email = $1 AND deleted = false LIMIT 1`,
            [username]
        );
        const auth = await validateLoginUser(user, password);
        if (!auth.ok) return resp(res, auth.code, auth.message);

        const token = jwt.sign(
            { id: auth.user.id, email: auth.user.email, role_id: auth.user.role_id, role_type_id: auth.user.role_type_id, portal: 'admin' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: auth.user.id, name: auth.user.name, email: auth.user.email,
            mobile: auth.user.mobile, role: auth.user.role_id, portal: 'admin', token
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── POST /api/AdminUsers/getProfile ─────────────────────────
router.post('/getProfile', async (req, res) => {
    try {
        const { id } = req.body;
        const user = await queryOne(
            `SELECT u.*,
                    c.company_name, c.support_mobile, c.support_email,
                    c.tagline, c.logo_file, c.primary_color_code,
                    c.address, c.public_phone_no, c.public_fax, c.public_email, c.website,
                    c.medical_officer_signature_file_name
             FROM admin_users u
             LEFT JOIN b2b_clients c ON c.id = u.user_id
             WHERE u.id = $1 LIMIT 1`,
            [id]
        );
        if (!user) return resp(res, '404', 'User not found');
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/AdminUsers ──────────────────────────────────────
// Optional ?status=true|false — dropdowns use status=true; management lists omit it.
router.get('/', async (req, res) => {
    try {
        const { user_id, status } = req.query;
        let sql = `SELECT id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted
                   FROM admin_users WHERE deleted = false`;
        const params = [];
        if (user_id) {
            params.push(user_id);
            sql += ` AND user_id = $${params.length}`;
        }
        if (status !== undefined && String(status).trim() !== '') {
            const raw = String(status).trim().toLowerCase();
            if (raw === 'true' || raw === '1' || raw === 'active') {
                sql += ' AND status IS DISTINCT FROM false';
            } else if (raw === 'false' || raw === '0' || raw === 'inactive') {
                sql += ' AND status = false';
            }
        }
        sql += ` ORDER BY id DESC`;
        const { rows } = await query(sql, params);
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/AdminUsers/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const user = await queryOne(
            `SELECT id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted
             FROM admin_users WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!user) return resp(res, '404', 'User not found');
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/AdminUsers ─────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { name, email, mobile, password, role_id, role_type_id, uid, image_file, user_id } = req.body;
        if (!password) return resp(res, '400', 'Password is required');
        const hashed = await bcrypt.hash(password, 10);
        const user = await queryOne(
            `INSERT INTO admin_users (name, email, mobile, password, role_id, role_type_id, uid, image_file, user_id, status, deleted)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false) RETURNING id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted`,
            [name, email, mobile, hashed, role_id, role_type_id, uid, image_file, user_id]
        );
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── PUT /api/AdminUsers/:id ──────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const { name, email, mobile, password, role_id, role_type_id, uid, image_file, status } = req.body;
        let hashed = undefined;
        if (password) hashed = await bcrypt.hash(password, 10);

        const user = await queryOne(
            `UPDATE admin_users SET
                name = COALESCE($1, name),
                email = COALESCE($2, email),
                mobile = COALESCE($3, mobile),
                password = COALESCE($4, password),
                role_id = COALESCE($5, role_id),
                role_type_id = COALESCE($6, role_type_id),
                uid = COALESCE($7, uid),
                image_file = COALESCE($8, image_file),
                status = COALESCE($9, status)
             WHERE id = $10
             RETURNING id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted`,
            [name, email, mobile, hashed, role_id, role_type_id, uid, image_file, status, req.params.id]
        );
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── DELETE /api/AdminUsers/:id (soft delete) ─────────────────
router.delete('/:id', async (req, res) => {
    try {
        const user = await queryOne(
            `UPDATE admin_users SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/AdminUsers/changePassword ──────────────────────
router.post('/changePassword', async (req, res) => {
    try {
        const { userId, oldPassword, newPassword } = req.body;
        const user = await queryOne(`SELECT * FROM admin_users WHERE id = $1`, [userId]);
        if (!user) return resp(res, '404', 'User not found');
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return resp(res, '401', 'Old password is incorrect');
        const hashed = await bcrypt.hash(newPassword, 10);
        await query(`UPDATE admin_users SET password = $1 WHERE id = $2`, [hashed, userId]);
        return resp(res, '200', 'Password changed successfully');
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

module.exports = router;
