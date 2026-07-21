// Dedicated route for specimen type ↔ lab test linking
// Uses the specimen_type_drug_linking table but with lab_test_id (not drug_id)
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// GET /api/SpecimenTypeDrugLinking?lab_test_id=X
// Optional ?status=true — dropdowns hide disabled links; management lists omit it.
router.get('/', async (req, res) => {
    try {
        const { lab_test_id, drug_id, specimen_type_id, b2b_client_id, status } = req.query;
        let where = 'WHERE stdl.deleted = false';
        const values = [];
        let idx = 1;

        // Support both lab_test_id (new) and drug_id (legacy) filtering
        if (lab_test_id) {
            where += ` AND stdl.lab_test_id = $${idx++}`;
            values.push(lab_test_id);
        }
        if (b2b_client_id) {
            where += ` AND (stdl.b2b_client_id = $${idx++} OR stdl.b2b_client_id IS NULL)`;
            values.push(b2b_client_id);
        }
        if (drug_id) {
            where += ` AND stdl.drug_id = $${idx++}`;
            values.push(drug_id);
        }
        if (specimen_type_id) {
            where += ` AND stdl.specimen_type_id = $${idx++}`;
            values.push(specimen_type_id);
        }
        if (status !== undefined && String(status).trim() !== '') {
            const raw = String(status).trim().toLowerCase();
            if (raw === 'true' || raw === '1' || raw === 'active') {
                where += ' AND stdl.status IS DISTINCT FROM false AND (st.status IS DISTINCT FROM false OR st.id IS NULL)';
            } else if (raw === 'false' || raw === '0' || raw === 'inactive') {
                where += ' AND stdl.status = false';
            }
        }

        // JOIN with specimen_type to get name
        const { rows } = await query(
            `SELECT stdl.*, st.name AS specimen_type_name
             FROM specimen_type_drug_linking stdl
             LEFT JOIN specimen_type st ON st.id = stdl.specimen_type_id
             ${where}
             ORDER BY stdl.id DESC`,
            values
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// GET /api/SpecimenTypeDrugLinking/:id
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `SELECT stdl.*, st.name AS specimen_type_name
             FROM specimen_type_drug_linking stdl
             LEFT JOIN specimen_type st ON st.id = stdl.specimen_type_id
             WHERE stdl.id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!row) return resp(res, '404', 'Not found');
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// POST /api/SpecimenTypeDrugLinking
// Accepts: { lab_test_id, specimen_type_id }  (or legacy drug_id)
router.post('/', async (req, res) => {
    try {
        const { lab_test_id, drug_id, specimen_type_id, b2b_client_id } = req.body;

        if (!specimen_type_id) {
            return resp(res, '400', 'specimen_type_id is required');
        }
        if (!lab_test_id && !drug_id) {
            return resp(res, '400', 'lab_test_id (or drug_id) is required');
        }

        // Check for duplicate
        const existing = await queryOne(
            `SELECT id FROM specimen_type_drug_linking
             WHERE deleted = false
               AND specimen_type_id = $1
               AND lab_test_id IS NOT DISTINCT FROM $2
             LIMIT 1`,
            [specimen_type_id, lab_test_id || null]
        );
        if (existing) {
            return resp(res, '400', 'This specimen type is already linked to this lab test');
        }

        const row = await queryOne(
            `INSERT INTO specimen_type_drug_linking
                (lab_test_id, drug_id, specimen_type_id, b2b_client_id, status, deleted, creation_timestamp)
             VALUES ($1, $2, $3, $4, true, false, NOW())
             RETURNING *`,
            [lab_test_id || null, drug_id || null, specimen_type_id, b2b_client_id || null]
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// PUT /api/SpecimenTypeDrugLinking/:id
router.put('/:id', async (req, res) => {
    try {
        const { specimen_type_id, status } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (specimen_type_id !== undefined) { fields.push(`specimen_type_id = $${idx++}`); values.push(specimen_type_id); }
        if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

        if (fields.length === 0) return resp(res, '400', 'No fields to update');
        values.push(req.params.id);

        const row = await queryOne(
            `UPDATE specimen_type_drug_linking SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// DELETE /api/SpecimenTypeDrugLinking/:id  (soft delete)
router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `UPDATE specimen_type_drug_linking
             SET deleted = true, deleted_timestamp = NOW()
             WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

module.exports = router;
