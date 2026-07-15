const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── GET /api/Patient ─────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT p.*, b.company_name as b2b_client_name 
             FROM patient p
             LEFT JOIN b2b_clients b ON b.id = p.b2b_client_id
             WHERE p.deleted = false ORDER BY p.id DESC`
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/Patient/getPatients (filtered) ─────────────────
router.post('/getPatients', async (req, res) => {
    try {
        const { b2b_client_id, name, mobile, uid, status } = req.body;
        let sql = `SELECT * FROM patient WHERE deleted = false`;
        const params = [];
        let i = 1;
        if (b2b_client_id) { sql += ` AND b2b_client_id = $${i++}`; params.push(b2b_client_id); }
        if (name)           { sql += ` AND name ILIKE $${i++}`;       params.push(`%${name}%`); }
        if (mobile)         { sql += ` AND mobile ILIKE $${i++}`;     params.push(`%${mobile}%`); }
        if (uid)            { sql += ` AND uid = $${i++}`;            params.push(uid); }
        if (status !== undefined) { sql += ` AND status = $${i++}`;   params.push(status); }
        sql += ` ORDER BY id DESC`;
        const { rows } = await query(sql, params);
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/Patient/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const patient = await queryOne(
            `SELECT * FROM patient WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!patient) return resp(res, '404', 'Patient not found');
        return resp(res, '200', patient);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/Patient ────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { b2b_client_id, uid, name, driving_license, mobile, email, gender, dob,
                street1, street2, city, state, zipcode, driving_license_state, ssn, user_id, role_type_id } = req.body;
        const patient = await queryOne(
            `INSERT INTO patient 
                (b2b_client_id, uid, name, driving_license, mobile, email, gender, dob,
                 street1, street2, city, state, zipcode, driving_license_state, ssn,
                 user_id, role_type_id, status, deleted)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,false)
             RETURNING *`,
            [b2b_client_id, uid, name, driving_license, mobile, email, gender, dob,
             street1, street2, city, state, zipcode, driving_license_state, ssn, user_id, role_type_id]
        );
        return resp(res, '200', patient);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── PUT /api/Patient/:id ─────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const { name, driving_license, mobile, email, gender, dob,
                street1, street2, city, state, zipcode, driving_license_state, ssn, status } = req.body;
        const patient = await queryOne(
            `UPDATE patient SET
                name = COALESCE($1, name),
                driving_license = COALESCE($2, driving_license),
                mobile = COALESCE($3, mobile),
                email = COALESCE($4, email),
                gender = COALESCE($5, gender),
                dob = COALESCE($6, dob),
                street1 = COALESCE($7, street1),
                street2 = COALESCE($8, street2),
                city = COALESCE($9, city),
                state = COALESCE($10, state),
                zipcode = COALESCE($11, zipcode),
                driving_license_state = COALESCE($12, driving_license_state),
                ssn = COALESCE($13, ssn),
                status = COALESCE($14, status)
             WHERE id = $15 RETURNING *`,
            [name, driving_license, mobile, email, gender, dob,
             street1, street2, city, state, zipcode, driving_license_state, ssn, status,
             req.params.id]
        );
        return resp(res, '200', patient);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── DELETE /api/Patient/:id (soft delete) ────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const patient = await queryOne(
            `UPDATE patient SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', patient);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

module.exports = router;
