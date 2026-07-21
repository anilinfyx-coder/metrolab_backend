const express = require('express');
const router = express.Router();
const { pool, query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { crudRoutes } = require('./crud');

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

        const { rows } = await query(`
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
            WHERE ${whereClause}
            ORDER BY ahc.creation_timestamp DESC
        `, values);

        return resp(res, '200', rows);
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
            date_of_examination, clinician_address, clinician_specialty
        } = req.body;

        const row = await queryOne(`
            INSERT INTO adult_health_certificates (
                patient_id, free_from_disease, satisfactory_physical, tuberculin_test_type,
                tuberculin_date_planted, tuberculin_date_read, tuberculin_result,
                chest_xray_date, chest_xray_result, additional_info, clinician_name,
                date_of_examination, clinician_address, clinician_specialty
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
            ) RETURNING *
        `, [
            patient_id, free_from_disease || false, satisfactory_physical || false, tuberculin_test_type,
            tuberculin_date_planted || null, tuberculin_date_read || null, tuberculin_result,
            chest_xray_date || null, chest_xray_result, additional_info, clinician_name,
            date_of_examination || null, clinician_address, clinician_specialty || null
        ]);

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
// Only difference: email encrypts the PDF with the patient's DOB (MMDD).
router.post('/downloadAdultHealthCertificate', async (req, res) => {
    try {
        const { buildAdultHealthCertPdf } = require('../utils/adultHealthCertPdf');
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Certificate id is required');

        const pdf = await buildAdultHealthCertPdf(id, { encrypt: false, authUser: req.user });
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
        const { buildAdultHealthCertPdf } = require('../utils/adultHealthCertPdf');
        const { sendCertificateMail } = require('../utils/emailService');
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Certificate id is required');

        // Identical PDF to download/preview branding — password-protected for email only
        const pdf = await buildAdultHealthCertPdf(id, { encrypt: true, authUser: req.user });
        const to = (pdf.cert.patient_email || '').trim();
        if (!to) return resp(res, '400', 'No email address found for this patient');

        if (!pdf.password) {
            return resp(res, '400', 'Patient date of birth is required to password-protect the PDF');
        }

        const ok = await sendCertificateMail(
            to,
            pdf.cert.patient_name,
            'Adult Health Certificate',
            pdf.buffer,
            pdf.filename
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
