const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const {
    DISPLAY_OPTION_FIELDS,
    mergeDisplayOptions,
    pickDisplayOptions,
    loadB2bLabTestAccess,
} = require('../utils/labTestDisplayOptions');

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { uploadBuffer, generateFileName, PREFIX } = require('../utils/gcs');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

async function ensureDisplayOptionColumns() {
    const columns = [
        'display_options_customized BOOLEAN DEFAULT FALSE',
        ...DISPLAY_OPTION_FIELDS.map((field) => `${field} BOOLEAN`),
        'medical_officer_name VARCHAR(255)',
        'medical_officer_position VARCHAR(255)',
        'mrocc VARCHAR(100)',
        'clia_number VARCHAR(100)',
        'medical_officer_signature_file_name VARCHAR(255)',
    ];
    for (const column of columns) {
        await query(`ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS ${column};`);
    }
}

async function persistUploadedSignature(file) {
    if (!file) return null;
    const { isGcsConfigured } = require('../utils/gcs');
    const fileName = generateFileName(file.originalname);
    if (isGcsConfigured()) {
        await uploadBuffer(file.buffer, PREFIX.b2bClients + fileName, file.mimetype);
    }
    return fileName;
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

// GET /api/B2bClientLabTestAccess/medical-officer?b2b_client_id=X&lab_test_id=Y
router.get('/medical-officer', async (req, res) => {
    try {
        await ensureDisplayOptionColumns();
        const { b2b_client_id, lab_test_id } = req.query;
        if (!b2b_client_id || !lab_test_id) {
            return resp(res, '400', 'b2b_client_id and lab_test_id are required');
        }

        const client = await queryOne(
            `SELECT medical_officer_name, medical_officer_position, mrocc, clia_number, medical_officer_signature_file_name
             FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
            [b2b_client_id]
        );
        if (!client) return resp(res, '404', 'B2B Client not found');

        const access = await loadB2bLabTestAccess(b2b_client_id, lab_test_id);

        let signature_url = null;
        let default_signature_url = null;

        const sigFileName = access?.medical_officer_signature_file_name || null;
        const defaultSigFileName = client.medical_officer_signature_file_name || null;

        const { isGcsConfigured, getSignedUrl } = require('../utils/gcs');
        if (isGcsConfigured()) {
            if (sigFileName) signature_url = await getSignedUrl(PREFIX.b2bClients + sigFileName);
            if (defaultSigFileName) default_signature_url = await getSignedUrl(PREFIX.b2bClients + defaultSigFileName);
        }

        return resp(res, '200', {
            b2b_client_id: Number(b2b_client_id),
            lab_test_id: Number(lab_test_id),
            medical_officer_name: access?.medical_officer_name || null,
            medical_officer_position: access?.medical_officer_position || null,
            mrocc: access?.mrocc || null,
            clia_number: access?.clia_number || null,
            medical_officer_signature_file_name: sigFileName,
            signature_url,
            is_customized: !!(access?.medical_officer_name || sigFileName),
            default_medical_officer: {
                medical_officer_name: client.medical_officer_name || null,
                medical_officer_position: client.medical_officer_position || null,
                mrocc: client.mrocc || null,
                clia_number: client.clia_number || null,
                medical_officer_signature_file_name: defaultSigFileName,
                default_signature_url,
            }
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST /api/B2bClientLabTestAccess/medical-officer
router.post('/medical-officer', upload.single('medical_officer_signature_file'), async (req, res) => {
    try {
        await ensureDisplayOptionColumns();
        const { b2b_client_id, lab_test_id, medical_officer_name, medical_officer_position, mrocc, clia_number, clear_custom } = req.body;
        if (!b2b_client_id || !lab_test_id) {
            return resp(res, '400', 'b2b_client_id and lab_test_id are required');
        }

        let access = await loadB2bLabTestAccess(b2b_client_id, lab_test_id);

        let uploadedSigFileName = null;
        if (req.file) {
            uploadedSigFileName = await persistUploadedSignature(req.file);
        }

        if (String(clear_custom) === 'true') {
            if (access) {
                access = await queryOne(
                    `UPDATE b2b_client_lab_test_access
                     SET medical_officer_name = NULL,
                         medical_officer_position = NULL,
                         mrocc = NULL,
                         clia_number = NULL,
                         medical_officer_signature_file_name = NULL
                     WHERE id = $1 RETURNING *`,
                    [access.id]
                );
            }
            return resp(res, '200', { message: 'Reverted to default B2B Lab Medical Officer successfully.', access });
        }

        const name = medical_officer_name !== undefined ? (medical_officer_name || null) : (access?.medical_officer_name || null);
        const pos = medical_officer_position !== undefined ? (medical_officer_position || null) : (access?.medical_officer_position || null);
        const mro = mrocc !== undefined ? (mrocc || null) : (access?.mrocc || null);
        const clia = clia_number !== undefined ? (clia_number || null) : (access?.clia_number || null);
        const sigFile = uploadedSigFileName || access?.medical_officer_signature_file_name || null;

        if (!access) {
            access = await queryOne(
                `INSERT INTO b2b_client_lab_test_access
                    (b2b_client_id, lab_test_id, status, deleted, creation_timestamp,
                     medical_officer_name, medical_officer_position, mrocc, clia_number, medical_officer_signature_file_name)
                 VALUES ($1, $2, true, false, NOW(), $3, $4, $5, $6, $7)
                 RETURNING *`,
                [b2b_client_id, lab_test_id, name, pos, mro, clia, sigFile]
            );
        } else {
            access = await queryOne(
                `UPDATE b2b_client_lab_test_access
                 SET medical_officer_name = $1,
                     medical_officer_position = $2,
                     mrocc = $3,
                     clia_number = $4,
                     medical_officer_signature_file_name = $5
                 WHERE id = $6
                 RETURNING *`,
                [name, pos, mro, clia, sigFile, access.id]
            );
        }

        return resp(res, '200', { message: 'Test-specific Medical Officer saved successfully.', access });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
