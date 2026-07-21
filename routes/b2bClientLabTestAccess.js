const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const {
    DISPLAY_OPTION_FIELDS,
    mergeDisplayOptions,
    pickDisplayOptions,
    loadB2bLabTestAccess,
} = require('../utils/labTestDisplayOptions');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

async function ensureDisplayOptionColumns() {
    const columns = [
        'display_options_customized BOOLEAN DEFAULT FALSE',
        ...DISPLAY_OPTION_FIELDS.map((field) => `${field} BOOLEAN`),
    ];
    for (const column of columns) {
        await query(`ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS ${column};`);
    }
}

// GET /api/B2bClientLabTestAccess?b2b_client_id=X
// Optional ?status=true — only access rows that are enabled (and linked lab test enabled when status=true).
router.get('/', async (req, res) => {
    try {
        await ensureDisplayOptionColumns();
        const { b2b_client_id, status } = req.query;
        let sql = `SELECT a.*
                   FROM b2b_client_lab_test_access a
                   LEFT JOIN lab_tests lt ON lt.id = a.lab_test_id
                   WHERE a.deleted = false`;
        const params = [];
        if (b2b_client_id) {
            params.push(b2b_client_id);
            sql += ` AND a.b2b_client_id = $${params.length}`;
        }
        if (status !== undefined && String(status).trim() !== '') {
            const raw = String(status).trim().toLowerCase();
            if (raw === 'true' || raw === '1' || raw === 'active') {
                sql += ' AND a.status IS DISTINCT FROM false AND lt.status IS DISTINCT FROM false AND lt.deleted = false';
            } else if (raw === 'false' || raw === '0' || raw === 'inactive') {
                sql += ' AND a.status = false';
            }
        }
        const { rows } = await query(sql, params);
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// GET /api/B2bClientLabTestAccess/display-options?b2b_client_id=X&lab_test_id=Y
router.get('/display-options', async (req, res) => {
    try {
        await ensureDisplayOptionColumns();
        const { b2b_client_id, lab_test_id } = req.query;
        if (!b2b_client_id || !lab_test_id) {
            return resp(res, '400', 'b2b_client_id and lab_test_id are required');
        }

        const labTest = await queryOne(
            `SELECT id, name, description, cost, cpt_code, default_view
             FROM lab_tests
             WHERE id = $1 AND deleted = false
             LIMIT 1`,
            [lab_test_id]
        );
        if (!labTest) return resp(res, '404', 'Lab test not found');

        const access = await loadB2bLabTestAccess(b2b_client_id, lab_test_id);
        const displayOptions = mergeDisplayOptions(
            await queryOne(`SELECT * FROM lab_tests WHERE id = $1 LIMIT 1`, [lab_test_id]),
            access
        );

        return resp(res, '200', {
            ...labTest,
            ...displayOptions,
            access_id: access?.id || null,
        });
    } catch (err) { return resp(res, '500', err.message); }
});

// PUT /api/B2bClientLabTestAccess/display-options
router.put('/display-options', async (req, res) => {
    try {
        await ensureDisplayOptionColumns();
        const { b2b_client_id, lab_test_id } = req.body;
        if (!b2b_client_id || !lab_test_id) {
            return resp(res, '400', 'b2b_client_id and lab_test_id are required');
        }

        const labTest = await queryOne(
            `SELECT id FROM lab_tests WHERE id = $1 AND deleted = false LIMIT 1`,
            [lab_test_id]
        );
        if (!labTest) return resp(res, '404', 'Lab test not found');

        const displayValues = pickDisplayOptions(req.body);
        let access = await loadB2bLabTestAccess(b2b_client_id, lab_test_id);

        if (!access) {
            access = await queryOne(
                `INSERT INTO b2b_client_lab_test_access
                    (b2b_client_id, lab_test_id, display_options_customized, deleted, status, creation_timestamp,
                     ${DISPLAY_OPTION_FIELDS.join(', ')})
                 VALUES ($1, $2, true, false, true, NOW(), ${DISPLAY_OPTION_FIELDS.map((_, i) => `$${i + 3}`).join(', ')})
                 RETURNING *`,
                [b2b_client_id, lab_test_id, ...DISPLAY_OPTION_FIELDS.map((field) => displayValues[field])]
            );
        } else {
            const setParts = [
                'display_options_customized = true',
                ...DISPLAY_OPTION_FIELDS.map((field, i) => `${field} = $${i + 1}`),
            ];
            access = await queryOne(
                `UPDATE b2b_client_lab_test_access
                 SET ${setParts.join(', ')}
                 WHERE id = $${DISPLAY_OPTION_FIELDS.length + 1}
                 RETURNING *`,
                [...DISPLAY_OPTION_FIELDS.map((field) => displayValues[field]), access.id]
            );
        }

        const merged = mergeDisplayOptions(
            await queryOne(`SELECT * FROM lab_tests WHERE id = $1 LIMIT 1`, [lab_test_id]),
            access
        );

        return resp(res, '200', {
            message: 'Report display options saved successfully.',
            ...merged,
            access_id: access.id,
        });
    } catch (err) { return resp(res, '500', err.message); }
});

// PUT /api/B2bClientLabTestAccess/status — toggle enable/disable for a specific B2B client only
// Does NOT touch lab_tests (superadmin table). Only updates/inserts b2b_client_lab_test_access.
router.put('/status', async (req, res) => {
    try {
        const { b2b_client_id, lab_test_id, status } = req.body;
        if (!b2b_client_id || !lab_test_id) {
            return resp(res, '400', 'b2b_client_id and lab_test_id are required');
        }

        const newStatus = status !== false;

        let access = await loadB2bLabTestAccess(b2b_client_id, lab_test_id);

        if (!access) {
            // No access row yet — create one with this status
            access = await queryOne(
                `INSERT INTO b2b_client_lab_test_access
                    (b2b_client_id, lab_test_id, status, deleted, creation_timestamp)
                 VALUES ($1, $2, $3, false, NOW())
                 RETURNING *`,
                [b2b_client_id, lab_test_id, newStatus]
            );
        } else {
            // Update only the status column
            access = await queryOne(
                `UPDATE b2b_client_lab_test_access
                 SET status = $1
                 WHERE id = $2
                 RETURNING *`,
                [newStatus, access.id]
            );
        }

        return resp(res, '200', { message: 'Status updated successfully.', status: access.status });
    } catch (err) { return resp(res, '500', err.message); }
});


router.post('/bulk', async (req, res) => {
    try {
        await ensureDisplayOptionColumns();
        const { b2b_client_id, lab_test_ids } = req.body;
        if (!b2b_client_id) return resp(res, '400', 'b2b_client_id is required');

        // Soft-delete existing access records
        await query(
            `UPDATE b2b_client_lab_test_access SET deleted = true WHERE b2b_client_id = $1`,
            [b2b_client_id]
        );

        // Insert new ones
        for (const lab_test_id of (lab_test_ids || [])) {
            // Check if a soft-deleted row exists to restore
            const existing = await queryOne(
                `SELECT id FROM b2b_client_lab_test_access WHERE b2b_client_id = $1 AND lab_test_id = $2 LIMIT 1`,
                [b2b_client_id, lab_test_id]
            );
            if (existing) {
                await query(
                    `UPDATE b2b_client_lab_test_access SET deleted = false WHERE id = $1`,
                    [existing.id]
                );
            } else {
                await query(
                    `INSERT INTO b2b_client_lab_test_access (b2b_client_id, lab_test_id, deleted) VALUES ($1, $2, false)`,
                    [b2b_client_id, lab_test_id]
                );
            }
        }

        return resp(res, '200', 'Lab test access saved successfully.');
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
