const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── POST /api/B2bClients/login ────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // B2B login uses email as username
        const client = await queryOne(
            `SELECT * FROM b2b_clients WHERE email = $1 AND deleted = false AND status = true LIMIT 1`,
            [username]
        );
        if (!client) return resp(res, '404', 'B2B Client not found');

        // Note: Ideally B2B passwords should be hashed. Using simple check if raw (can be updated to bcrypt)
        // If password is not hashed yet, this compares raw strings. If hashed, use bcrypt.
        let isMatch = false;
        if (client.password.startsWith('$2a$') || client.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, client.password);
        } else {
            isMatch = (password === client.password);
        }

        if (!isMatch) return resp(res, '401', 'Invalid credentials');

        const token = jwt.sign(
            { id: client.id, email: client.email, role_id: client.role_id, portal: 'b2b' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: client.id, name: client.company_name, email: client.email,
            mobile: client.mobile, portal: 'b2b', token
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── GET /api/B2bClients ───────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(`SELECT * FROM b2b_clients WHERE deleted = false ORDER BY id DESC`);
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── POST /api/B2bClients/changePassword ───────────────────────
router.post('/changePassword', async (req, res) => {
    try {
        const { userId, oldPassword, newPassword } = req.body;
        if (!userId || !oldPassword || !newPassword) {
            return resp(res, '400', 'userId, oldPassword and newPassword are required');
        }
        if (String(newPassword).length < 6) {
            return resp(res, '400', 'New password must be at least 6 characters');
        }
        if (/[^a-zA-Z0-9@#]/.test(String(newPassword))) {
            return resp(res, '400', 'Only @ # are allowed as special characters');
        }

        const client = await queryOne(`SELECT * FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`, [userId]);
        if (!client) return resp(res, '404', 'B2B Client not found');

        let isMatch = false;
        if (client.password && (client.password.startsWith('$2a$') || client.password.startsWith('$2b$'))) {
            isMatch = await bcrypt.compare(oldPassword, client.password);
        } else {
            isMatch = (oldPassword === client.password);
        }
        if (!isMatch) return resp(res, '401', 'Old password is incorrect');

        const hashed = await bcrypt.hash(newPassword, 10);
        await query(`UPDATE b2b_clients SET password = $1 WHERE id = $2`, [hashed, userId]);
        return resp(res, '200', 'Password changed successfully');
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/B2bClients ──────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const {
            role_id, company_name, contact_person_name, mobile, public_phone_no,
            email, public_email, public_fax, address, country_id, state_id, city_id,
            district_id, region_id, pincode, support_mobile, support_email, support_person_name,
            password, tagline, logo_file, report_header_file, report_footer_file,
            primary_color_code, website, medical_officer_name, mrocc, clia_number,
            medical_officer_position, medical_officer_signature_file_name,
            is_approval, approval_note, smtp_server, smtp_port, smtp_email, smtp_password,
            user_id, role_type_id
        } = req.body;

        const row = await queryOne(
            `INSERT INTO b2b_clients (
                role_id, company_name, contact_person_name, mobile, public_phone_no,
                email, public_email, public_fax, address, country_id, state_id, city_id,
                district_id, region_id, pincode, support_mobile, support_email, support_person_name,
                password, tagline, logo_file, report_header_file, report_footer_file,
                primary_color_code, website, medical_officer_name, mrocc, clia_number,
                medical_officer_position, medical_officer_signature_file_name,
                is_approval, approval_note, smtp_server, smtp_port, smtp_email, smtp_password,
                user_id, role_type_id, status, deleted
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
                $37,$38,true,false
            ) RETURNING *`,
            [role_id, company_name, contact_person_name, mobile, public_phone_no,
                email, public_email, public_fax, address, country_id, state_id, city_id,
                district_id, region_id, pincode, support_mobile, support_email, support_person_name,
                password, tagline, logo_file, report_header_file, report_footer_file,
                primary_color_code, website, medical_officer_name, mrocc, clia_number,
                medical_officer_position, medical_officer_signature_file_name,
                is_approval, approval_note, smtp_server, smtp_port, smtp_email, smtp_password,
                user_id, role_type_id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── GET /api/B2bClients/:id ───────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `SELECT id, role_id, company_name, contact_person_name, mobile, public_phone_no,
                    email, public_email, public_fax, address, support_mobile, support_email,
                    support_person_name, tagline, primary_color_code, website,
                    smtp_server, smtp_port, smtp_email, smtp_password, status, deleted
             FROM b2b_clients WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!row) return resp(res, '404', 'B2B Client not found');
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── PUT /api/B2bClients/:id ───────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const body = req.body || {};
        const fields = [
            'company_name', 'contact_person_name', 'mobile', 'email', 'address', 'pincode',
            'public_phone_no', 'public_email', 'public_fax',
            'support_person_name', 'support_mobile', 'support_email',
            'tagline', 'primary_color_code', 'website',
            'medical_officer_name', 'medical_officer_position', 'mrocc', 'clia_number',
            'logo_file', 'report_header_file', 'report_footer_file', 'medical_officer_signature_file_name',
            'smtp_server', 'smtp_port', 'smtp_email', 'smtp_password',
            'is_approval', 'approval_note', 'status',
        ];

        const updates = [];
        const values = [];
        let idx = 1;

        for (const key of fields) {
            if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
                updates.push(`${key} = $${idx++}`);
                values.push(body[key]);
            }
        }

        if (body.password) {
            const nextPassword = (String(body.password).startsWith('$2a$') || String(body.password).startsWith('$2b$'))
                ? body.password
                : await bcrypt.hash(body.password, 10);
            updates.push(`password = $${idx++}`);
            values.push(nextPassword);
        }

        if (updates.length === 0) return resp(res, '400', 'No fields to update');

        values.push(req.params.id);
        const row = await queryOne(
            `UPDATE b2b_clients SET ${updates.join(', ')}
             WHERE id = $${idx}
             RETURNING id, role_id, company_name, contact_person_name, mobile, public_phone_no,
                       email, public_email, public_fax, address, support_mobile, support_email,
                       support_person_name, tagline, primary_color_code, website,
                       smtp_server, smtp_port, smtp_email, smtp_password, status, deleted`,
            values
        );
        if (!row) return resp(res, '404', 'B2B Client not found');
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── DELETE /api/B2bClients/:id ────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `UPDATE b2b_clients SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
