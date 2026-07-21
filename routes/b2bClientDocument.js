const express = require('express');
const router = express.Router();
const multer = require('multer');
const { query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { uploadBuffer, deleteObject, getSignedUrl, generateFileName } = require('../utils/gcs');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// Files are stored in GCS under this prefix. `file_name` in the DB stays a
// flat name (as before); the prefix is only ever applied server-side.
const GCS_PREFIX = 'b2b-client-documents/';

// Uploads are buffered in memory, then pushed to GCS (Cloud Run's container
// filesystem is ephemeral and not shared across instances).
const upload = multer({ storage: multer.memoryStorage() });

// GET file helper (public - no auth required so browser can open files directly).
// Redirects to a short-lived pre-signed GCS URL rather than serving the file itself.
router.get('/file/:filename', async (req, res) => {
    try {
        const url = await getSignedUrl(GCS_PREFIX + req.params.filename);
        return res.redirect(url);
    } catch (err) {
        console.error(err);
        return res.status(404).send('File not found');
    }
});

router.use(authMiddleware);

// GET /api/B2bClientDocument/getB2bClientDocumentList
router.post('/getB2bClientDocumentList', async (req, res) => {
    try {
        const { b2b_client_id } = req.body;
        if (!b2b_client_id) return resp(res, '400', 'b2b_client_id required');
        
        const q = `
            SELECT d.*, t.name as "typeData"
            FROM b2b_client_document d
            LEFT JOIN document_type t ON d.type_data_id = t.id
            WHERE d.b2b_client_id = $1 AND d.deleted = false
            ORDER BY d.id DESC
        `;
        const { rows } = await query(q, [b2b_client_id]);
        return resp(res, '200', rows);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST /api/B2bClientDocument/saveB2bClientDocument
router.post('/saveB2bClientDocument', upload.single('UploadFile'), async (req, res) => {
    try {
        const data = req.body;
        let fileName = data.fileName || null;

        if (req.file) {
            fileName = generateFileName(req.file.originalname);
            await uploadBuffer(req.file.buffer, GCS_PREFIX + fileName, req.file.mimetype);
        }

        if (data.id && data.id !== '0' && data.id !== 'undefined' && data.id !== 'null') {
            // Update
            const existing = await queryOne(`SELECT * FROM b2b_client_document WHERE id = $1`, [data.id]);
            if (req.file && existing && existing.file_name) {
                // Delete old file if a new one is uploaded
                await deleteObject(GCS_PREFIX + existing.file_name);
            }

            await queryOne(`
                UPDATE b2b_client_document 
                SET type_data_id = $1, file_name = COALESCE($2, file_name)
                WHERE id = $3
            `, [data.typeDataId, fileName, data.id]);
            return resp(res, '200', 'Document updated successfully');
        } else {
            // Insert
            await queryOne(`
                INSERT INTO b2b_client_document (b2b_client_id, type_data_id, file_name, creation_timestamp, created_by_id, deleted)
                VALUES ($1, $2, $3, NOW(), $4, false)
            `, [data.b2bClientId, data.typeDataId, fileName, req.user.id]);
            return resp(res, '200', 'Document saved successfully');
        }
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST /api/B2bClientDocument/deleteB2bClientDocument
router.post('/deleteB2bClientDocument', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return resp(res, '400', 'id required');
        
        await queryOne(`
            UPDATE b2b_client_document 
            SET deleted = true, deleted_timestamp = NOW(), deleted_by_id = $1
            WHERE id = $2
        `, [req.user.id, id]);
        return resp(res, '200', 'Document deleted successfully');
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});


module.exports = router;
