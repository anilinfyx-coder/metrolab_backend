const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// GET /api/B2bClientLabTestAccess?b2b_client_id=X
router.get('/', async (req, res) => {
    try {
        const { b2b_client_id } = req.query;
        let sql = `SELECT * FROM b2b_client_lab_test_access WHERE deleted = false`;
        const params = [];
        if (b2b_client_id) {
            params.push(b2b_client_id);
            sql += ` AND b2b_client_id = $${params.length}`;
        }
        const { rows } = await query(sql, params);
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// POST /api/B2bClientLabTestAccess/bulk — replace all for a B2B client
router.post('/bulk', async (req, res) => {
    try {
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
