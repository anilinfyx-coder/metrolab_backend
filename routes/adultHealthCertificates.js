const express = require('express');
const router = express.Router();
const { pool, query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { crudRoutes } = require('./crud');
const { decryptPIIFields } = require('../utils/cryptoUtils');
const { respondListQuery } = require('../utils/pagination');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

router.use(authMiddleware);

// GET with Patient Details Joined
router.get('/', async (req, res) => {
    try {
        let whereClause = "ahc.deleted = false";
        const values = [];

        if (req.query.patient_id) {
            values.push(req.query.patient_id);
            whereClause += ` AND ahc.patient_id = $${values.length}`;
        }
        if (req.query.waiting_list_id) {
            values.push(req.query.waiting_list_id);
            whereClause += ` AND ahc.waiting_list_id = $${values.length}`;
        }
        if (req.query.lab_test_id) {
            values.push(req.query.lab_test_id);
            whereClause += ` AND ahc.lab_test_id = $${values.length}`;
        }

        const { resolveAdminContext } = require('../utils/adminContext');
        if (req.user && req.user.portal === 'b2b') {
            values.push(req.user.id);
            whereClause += ` AND p.b2b_client_id = $${values.length}`;
        } else if (req.user && req.user.portal === 'corporate') {
            values.push(req.user.id);
            whereClause += ` AND p.corporate_client_id = $${values.length}`;
        } else if (req.user && req.user.portal === 'admin') {
            const ctx = await resolveAdminContext(req.user.id);
            if (ctx.b2b_client_id) {
                values.push(ctx.b2b_client_id);
                whereClause += ` AND p.b2b_client_id = $${values.length}`;
            } else if (ctx.corporate_client_id) {
                values.push(ctx.corporate_client_id);
                whereClause += ` AND p.corporate_client_id = $${values.length}`;
            }
        }

        const dataSql = `
            SELECT 
                ahc.*,
                p.name, p.dob, p.gender as sex, p.mobile as tel, p.email as patient_email, p.uid as patient_uid,
                p.street1, p.street2, p.city, p.state, p.zipcode,
                b2b.company_name as b2b_company_name, b2b.logo_file as b2b_logo,
                b2b.address as b2b_address, b2b.public_phone_no as b2b_phone,
                b2b.public_fax as b2b_fax, b2b.public_email as b2b_email, b2b.website as b2b_website,
                b2b.medical_officer_signature_file_name as b2b_signature
            FROM adult_health_certificates ahc
            LEFT JOIN patient p ON ahc.patient_id = p.id
            LEFT JOIN b2b_clients b2b ON p.b2b_client_id = b2b.id
            WHERE ${whereClause}`;

        const countSql = `
            SELECT COUNT(*)::int AS total
            FROM adult_health_certificates ahc
            LEFT JOIN patient p ON ahc.patient_id = p.id
            LEFT JOIN b2b_clients b2b ON p.b2b_client_id = b2b.id
            WHERE ${whereClause}`;

        return await respondListQuery(req, res, resp, {
            dataSql,
            countSql,
            params: values,
            orderBy: 'ORDER BY ahc.creation_timestamp DESC',
            defaultLimit: 25,
            mapRow: decryptPIIFields
        });
    } catch (err) {
    return resp(res, '500', err.message);
}
});

router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(`
            SELECT 
                ahc.*,
                p.name, p.dob, p.gender as sex, p.mobile as tel, p.email as patient_email, p.uid as patient_uid,
                p.street1, p.street2, p.city, p.state, p.zipcode,
                b2b.company_name as b2b_company_name, b2b.logo_file as b2b_logo,
                b2b.address as b2b_address, b2b.public_phone_no as b2b_phone,
                b2b.public_fax as b2b_fax, b2b.public_email as b2b_email, b2b.website as b2b_website,
                b2b.medical_officer_signature_file_name as b2b_signature
            FROM adult_health_certificates ahc
            LEFT JOIN patient p ON ahc.patient_id = p.id
            LEFT JOIN b2b_clients b2b ON p.b2b_client_id = b2b.id
            WHERE ahc.id = $1 AND ahc.deleted = false
        `, [req.params.id]);

        if (!row) return resp(res, '404', 'Not found');
        const b2bClientId = row.b2b_client_id || row.patient_b2b_client_id;
        if (b2bClientId && row.lab_test_id) {
            const testAccess = await queryOne(
                `SELECT medical_officer_name, medical_officer_position, mrocc, clia_number, medical_officer_signature_file_name
                 FROM b2b_client_lab_test_access
                 WHERE b2b_client_id = $1 AND lab_test_id = $2 AND deleted = false LIMIT 1`,
                [b2bClientId, row.lab_test_id]
            );
            if (testAccess) {
                if (testAccess.medical_officer_name) row.medical_officer_name = testAccess.medical_officer_name;
                if (testAccess.medical_officer_position) row.medical_officer_position = testAccess.medical_officer_position;
                if (testAccess.mrocc) row.mrocc = testAccess.mrocc;
                if (testAccess.clia_number) row.clia_number = testAccess.clia_number;
                if (testAccess.medical_officer_signature_file_name) row.b2b_signature = testAccess.medical_officer_signature_file_name;
            }
        }
        decryptPIIFields(row);
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.post('/', async (req, res) => {
    try {
        const {
            patient_id, free_from_disease, satisfactory_physical, tuberculin_test_type,
            tuberculin_date_planted, tuberculin_date_read, tuberculin_result,
            chest_xray_date, chest_xray_result, additional_info, clinician_name,
            date_of_examination, clinician_address, clinician_specialty,
            waiting_list_id, lab_test_id
        } = req.body;

        const row = await queryOne(`
            INSERT INTO adult_health_certificates (
                patient_id, free_from_disease, satisfactory_physical, tuberculin_test_type,
                tuberculin_date_planted, tuberculin_date_read, tuberculin_result,
                chest_xray_date, chest_xray_result, additional_info, clinician_name,
                date_of_examination, clinician_address, clinician_specialty,
                waiting_list_id, lab_test_id
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            ) RETURNING *
        `, [
            patient_id, free_from_disease || false, satisfactory_physical || false, tuberculin_test_type,
            tuberculin_date_planted || null, tuberculin_date_read || null, tuberculin_result,
            chest_xray_date || null, chest_xray_result, additional_info, clinician_name,
            date_of_examination || null, clinician_address, clinician_specialty || null,
            waiting_list_id || null, lab_test_id || null
        ]);

        if (waiting_list_id && lab_test_id) {
            const wl = await queryOne('SELECT b2b_client_id, corporate_client_id FROM waiting_list WHERE id = $1', [waiting_list_id]);
            const resolvedB2bId = wl ? wl.b2b_client_id : null;
            const resolvedCorporateId = wl ? wl.corporate_client_id : null;

            const lastUidRow = await queryOne(
                `SELECT uid FROM lab_test_category_report
                 WHERE uid ~ '^LTCR[0-9]+$'
                 ORDER BY CAST(SUBSTRING(uid FROM 5) AS INTEGER) DESC
                 LIMIT 1`
            );
            let nextNum = 1;
            if (lastUidRow?.uid) {
                const parsed = parseInt(String(lastUidRow.uid).slice(4), 10);
                if (!Number.isNaN(parsed)) nextNum = parsed + 1;
            }
            const reportUid = `LTCR${String(nextNum).padStart(4, '0')}`;

            await query(
                `INSERT INTO lab_test_category_report (
                    uid, waiting_list_id, lab_test_id, patient_id, 
                    b2b_client_id, corporate_client_id, 
                    report_status, final_result, deleted, creation_timestamp, status
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, 'Completed', 'Custom Certificate', false, NOW(), false)
                 ON CONFLICT DO NOTHING`,
                [reportUid, waiting_list_id, lab_test_id, patient_id, resolvedB2bId, resolvedCorporateId]
            );
        }

        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body;

        let updates = [];
        let values = [];
        let idx = 1;

        const allowedFields = [
            'free_from_disease', 'satisfactory_physical', 'tuberculin_test_type',
            'tuberculin_date_planted', 'tuberculin_date_read', 'tuberculin_result',
            'chest_xray_date', 'chest_xray_result', 'additional_info', 'clinician_name',
            'date_of_examination', 'clinician_address', 'clinician_specialty'
        ];

        for (const [key, value] of Object.entries(body)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = $${idx}`);
                values.push(value === '' ? null : value);
                idx++;
            }
        }

        if (updates.length === 0) return resp(res, '400', 'No fields to update');

        values.push(id);
        const q = `UPDATE adult_health_certificates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
        const row = await queryOne(q, values);
        if (!row) return resp(res, '404', 'Not found');
        decryptPIIFields(row);
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            'UPDATE adult_health_certificates SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// Download + email share the SAME builder (layout, lab branding, logo/signature).
router.post('/downloadAdultHealthCertificate', async (req, res) => {
    try {
        const { buildAdultHealthCertForDelivery } = require('../utils/certPdfDelivery');
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Certificate id is required');

        const pdf = await buildAdultHealthCertForDelivery(id, req.user);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${pdf.filename}`);
        return res.send(pdf.buffer);
    } catch (err) {
        console.error('downloadAdultHealthCertificate error: ', err);
        return resp(res, '500', err.message || 'Internal Server Error');
    }
});

router.post('/emailAdultHealthCertificate', async (req, res) => {
    try {
        const { buildAdultHealthCertForDelivery } = require('../utils/certPdfDelivery');
        const { sendCertificateMail } = require('../utils/emailService');
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Certificate id is required');

        const pdf = await buildAdultHealthCertForDelivery(id, req.user);
        const to = (pdf.cert.patient_email || '').trim();
        if (!to) return resp(res, '400', 'No email address found for this patient');

        const ok = await sendCertificateMail(
            to,
            pdf.cert.patient_name,
            'Adult Health Certificate',
            pdf.buffer,
            pdf.filename,
            pdf.lab
        );

        if (!ok) {
            return resp(res, '500', 'Failed to send email. Please check server logs.');
        }

        return resp(res, '200', 'Certificate emailed successfully');
    } catch (err) {
        console.error("emailAdultHealthCertificate error: ", err);
        return resp(res, '500', err.message || 'Internal Server Error');
    }
});

module.exports = router;
