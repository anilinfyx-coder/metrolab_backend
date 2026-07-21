const express = require('express');
const router = express.Router();
const { pool, query, queryOne, formatDbError, isTooManyConnectionsError } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { resolveAdminContext } = require('../utils/adminContext');
const { encryptPII, decryptPII } = require('../utils/cryptoUtils');

function mapPatient(p) {
    if (!p) return p;
    if (p.driving_license) p.driving_license = decryptPII(p.driving_license);
    if (p.ssn) p.ssn = decryptPII(p.ssn);
    if (p.dob) p.dob = decryptPII(p.dob);
    return p;
}

const resp = (res, code, obj) => res.json({ response_code: code, obj });

router.use(authMiddleware);

async function generateNextPatientUid(dbClient) {
    const run = (text, params) => dbClient.query(text, params);

    const { rows } = await run(
        `SELECT uid FROM patient
         WHERE uid ~ '^PT[0-9]+$'
         ORDER BY CAST(SUBSTRING(uid FROM 3) AS INTEGER) DESC
         LIMIT 1
         FOR UPDATE`
    );

    let nextNum = 1;
    if (rows[0]?.uid) {
        const parsed = parseInt(rows[0].uid.slice(2), 10);
        if (!Number.isNaN(parsed)) nextNum = parsed + 1;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
        const uid = `PT${String(nextNum + attempt).padStart(3, '0')}`;
        const exists = await run(`SELECT id FROM patient WHERE uid = $1 LIMIT 1`, [uid]);
        if (exists.rows.length === 0) return uid;
    }

    throw new Error('Unable to generate a unique patient UID');
}

async function resolveAdminContextForRequest(userId) {
    return resolveAdminContext(userId);
}

// ── GET /api/Patient ─────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        let whereClause = `WHERE p.deleted = false`;
        const params = [];
        let i = 1;

        if (req.user && req.user.portal === 'b2b') {
            whereClause += ` AND p.b2b_client_id = $${i++}`;
            params.push(req.user.id);
        } else if (req.user && req.user.portal === 'corporate') {
            whereClause += ` AND p.corporate_client_id = $${i++}`;
            params.push(req.user.id);
        } else if (req.user && req.user.portal === 'admin') {
            const ctx = await resolveAdminContextForRequest(req.user.id);
            if (ctx.b2b_client_id) {
                whereClause += ` AND p.b2b_client_id = $${i++}`;
                params.push(ctx.b2b_client_id);
            } else if (ctx.corporate_client_id) {
                whereClause += ` AND p.corporate_client_id = $${i++}`;
                params.push(ctx.corporate_client_id);
            }
        }

        const { rows } = await query(
            `SELECT p.*, b.company_name as b2b_client_name 
             FROM patient p
             LEFT JOIN b2b_clients b ON b.id = p.b2b_client_id
             ${whereClause} ORDER BY p.id DESC LIMIT 1000`, params
        );
        return resp(res, '200', rows.map(mapPatient));
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/Patient/search?uid=&mobile= ───────────────────
router.get('/search', async (req, res) => {
    try {
        const { uid, mobile } = req.query;
        if (!uid && !mobile) return resp(res, '400', 'UID or Mobile is required');

        let sql = `SELECT * FROM patient WHERE deleted = false`;
        const params = [];
        let i = 1;

        if (uid) {
            sql += ` AND uid ILIKE $${i++}`;
            params.push(String(uid).trim());
        }
        if (mobile) {
            sql += ` AND mobile ILIKE $${i++}`;
            params.push(`%${String(mobile).trim()}%`);
        }

        sql += ` ORDER BY id DESC LIMIT 1`;
        const patient = await queryOne(sql, params);
        if (!patient) return resp(res, '404', 'Patient not found');
        return resp(res, '200', mapPatient(patient));
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

        if (req.user && req.user.portal === 'b2b') {
            sql += ` AND b2b_client_id = $${i++}`; params.push(req.user.id);
        } else if (req.user && req.user.portal === 'corporate') {
            sql += ` AND corporate_client_id = $${i++}`; params.push(req.user.id);
        } else if (req.user && req.user.portal === 'admin') {
            const ctx = await resolveAdminContextForRequest(req.user.id);
            if (ctx.b2b_client_id) {
                sql += ` AND b2b_client_id = $${i++}`; params.push(ctx.b2b_client_id);
            } else if (ctx.corporate_client_id) {
                sql += ` AND corporate_client_id = $${i++}`; params.push(ctx.corporate_client_id);
            } else if (b2b_client_id) {
                sql += ` AND b2b_client_id = $${i++}`; params.push(b2b_client_id);
            }
        } else if (b2b_client_id) {
            sql += ` AND b2b_client_id = $${i++}`; params.push(b2b_client_id);
        }

        if (name)           { sql += ` AND name ILIKE $${i++}`;       params.push(`%${name}%`); }
        if (mobile)         { sql += ` AND mobile ILIKE $${i++}`;     params.push(`%${mobile}%`); }
        if (uid)            { sql += ` AND uid = $${i++}`;            params.push(uid); }
        if (status !== undefined) { sql += ` AND status = $${i++}`;   params.push(status); }
        sql += ` ORDER BY id DESC LIMIT 500`;
        const { rows } = await query(sql, params);
        return resp(res, '200', rows.map(mapPatient));
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
        return resp(res, '200', mapPatient(patient));
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/Patient ────────────────────────────────────────
router.post('/', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const {
            b2b_client_id, uid, name, driving_license, mobile, email, gender, dob,
            street1, street2, city, state, zipcode, driving_license_state, ssn,
            user_id, role_type_id
        } = req.body;

        const ctx = await resolveAdminContextForRequest(req.user.id);

        await client.query('BEGIN');

        let patientUid = (uid || '').trim();
        if (!patientUid) {
            patientUid = await generateNextPatientUid(client);
        } else {
            const dup = await client.query(
                `SELECT id FROM patient WHERE uid = $1 AND deleted = false LIMIT 1`,
                [patientUid]
            );
            if (dup.rows.length > 0) {
                await client.query('ROLLBACK');
                return resp(res, '400', `Patient UID ${patientUid} already exists.`);
            }
        }

        const insert = await client.query(
            `INSERT INTO patient 
                (b2b_client_id, uid, name, driving_license, mobile, email, gender, dob,
                 street1, street2, city, state, zipcode, driving_license_state, ssn,
                 created_by_id, user_id, role_type_id, status, deleted, creation_timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true,false,NOW())
             RETURNING *`,
            [
                b2b_client_id || ctx.b2b_client_id,
                patientUid,
                name,
                encryptPII(driving_license),
                mobile,
                email,
                gender,
                encryptPII(dob),
                street1,
                street2,
                city,
                state,
                zipcode,
                driving_license_state,
                encryptPII(ssn),
                ctx.created_by_id,
                user_id || ctx.user_id,
                role_type_id || ctx.role_type_id,
            ]
        );

        await client.query('COMMIT');
        return resp(res, '200', mapPatient(insert.rows[0]));
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
        }
        if (err.code === '23505') {
            return resp(res, '400', 'Patient UID already exists.');
        }
        if (isTooManyConnectionsError(err)) {
            return resp(res, '503', formatDbError(err));
        }
        return resp(res, '500', err.message);
    } finally {
        if (client) client.release();
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
            [name, driving_license ? encryptPII(driving_license) : null, mobile, email, gender, dob ? encryptPII(dob) : null,
             street1, street2, city, state, zipcode, driving_license_state, ssn ? encryptPII(ssn) : null, status,
             req.params.id]
        );
        return resp(res, '200', mapPatient(patient));
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
