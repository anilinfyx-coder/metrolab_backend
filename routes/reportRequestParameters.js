const express = require('express');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const {
    TABLE,
    ensureSourceParameterColumn,
    listEffectiveParams,
    upsertB2bOverride,
    updateOverrideRow,
} = require('../utils/reportRequestParameters');

const router = express.Router();
const resp = (res, code, obj) => res.json({ response_code: code, obj });

function getPortalUser(req) {
    try {
        const token = req.headers['token'] || req.headers['authorization']?.replace('Bearer ', '');
        if (!token) return null;
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

// GET /api/ReportRequestParameters
router.get('/', async (req, res) => {
    try {
        await ensureSourceParameterColumn();

        const b2bClientId = req.query.b2b_client_id != null && String(req.query.b2b_client_id).trim() !== ''
            ? Number(req.query.b2b_client_id)
            : null;
        const labTestId = req.query.lab_test_id != null && String(req.query.lab_test_id).trim() !== ''
            ? Number(req.query.lab_test_id)
            : null;
        const activeOnly = req.query.status !== undefined
            && ['true', '1', 'active'].includes(String(req.query.status).trim().toLowerCase());

        if (b2bClientId) {
            const rows = await listEffectiveParams(b2bClientId, { labTestId, activeOnly });
            return resp(res, '200', rows);
        }

        let whereClause = 'WHERE deleted = false';
        const values = [];
        let index = 1;

        if (activeOnly) {
            whereClause += ' AND status IS DISTINCT FROM false';
        }

        const filterable = ['lab_test_id', 'drug_id', 'corporate_client_id', 'specimen_type_id'];
        for (const key of filterable) {
            if (req.query[key] !== undefined) {
                whereClause += ` AND ${key} = $${index++}`;
                values.push(req.query[key]);
            }
        }

        const { rows } = await query(
            `SELECT * FROM ${TABLE} ${whereClause} ORDER BY id DESC`,
            values,
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [req.params.id]);
        if (!row) return resp(res, '404', `${TABLE} not found`);
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.post('/', async (req, res) => {
    try {
        await ensureSourceParameterColumn();
        const body = { ...req.body };
        delete body.id;
        delete body.status;
        delete body.deleted;
        delete body.creation_timestamp;
        delete body.deleted_timestamp;
        delete body.source_parameter_id;

        const user = getPortalUser(req);
        if (user?.portal === 'b2b') {
            body.b2b_client_id = user.id;
        }

        const fields = Object.keys(body);
        if (fields.length === 0) return resp(res, '400', 'No data provided');
        const cols = fields.join(', ');
        const vals = fields.map((_, i) => `$${i + 1}`).join(', ');
        const values = fields.map((f) => body[f]);
        const row = await queryOne(
            `INSERT INTO ${TABLE} (${cols}, status, deleted, creation_timestamp)
             VALUES (${vals}, true, false, NOW()) RETURNING *`,
            values,
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.put('/:id', async (req, res) => {
    try {
        await ensureSourceParameterColumn();
        const existing = await queryOne(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [req.params.id]);
        if (!existing) return resp(res, '404', `${TABLE} not found`);

        const user = getPortalUser(req);
        const updates = { ...req.body };
        delete updates.id;
        delete updates.b2b_client_id;
        delete updates.source_parameter_id;
        delete updates.creation_timestamp;
        delete updates.deleted;
        delete updates.deleted_timestamp;

        if (user?.portal === 'b2b') {
            const b2bClientId = user.id;

            if (existing.b2b_client_id == null) {
                const row = await upsertB2bOverride(existing, b2bClientId, updates);
                return resp(res, '200', row);
            }

            if (Number(existing.b2b_client_id) !== Number(b2bClientId)) {
                return resp(res, '403', 'Forbidden');
            }

            const row = await updateOverrideRow(existing.id, updates);
            return resp(res, '200', row);
        }

        const fields = Object.keys(updates);
        if (fields.length === 0) return resp(res, '400', 'No data to update');
        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        const values = fields.map((f) => updates[f]);
        values.push(req.params.id);
        const row = await queryOne(
            `UPDATE ${TABLE} SET ${setClause} WHERE id = $${values.length} RETURNING *`,
            values,
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const existing = await queryOne(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [req.params.id]);
        if (!existing) return resp(res, '404', `${TABLE} not found`);

        const user = getPortalUser(req);
        if (user?.portal === 'b2b') {
            if (existing.b2b_client_id == null) {
                return resp(res, '403', 'Global parameters cannot be deleted.');
            }
            if (Number(existing.b2b_client_id) !== Number(user.id)) {
                return resp(res, '403', 'Forbidden');
            }
        }

        const row = await queryOne(
            `UPDATE ${TABLE} SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id],
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

module.exports = router;
