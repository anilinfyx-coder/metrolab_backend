const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── POST /api/SuperAdmin/login ────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await queryOne(
            `SELECT * FROM super_admin WHERE email = $1 AND deleted = false AND status = true LIMIT 1`,
            [username]
        );
        if (!user) return resp(res, '404', 'Super Admin not found');

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return resp(res, '401', 'Invalid credentials');

        const token = jwt.sign(
            { id: user.id, email: user.email, role_id: user.role_id, role_type_id: user.role_type_id, portal: 'superadmin' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: user.id, name: user.name, email: user.email,
            mobile: user.mobile, role: user.role_id, portal: 'superadmin', token
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── GET /api/SuperAdmin ──────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(`SELECT * FROM super_admin WHERE deleted = false ORDER BY id DESC`);
        return resp(res, '200', rows);
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
