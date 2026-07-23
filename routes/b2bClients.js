const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { query, queryOne } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { sendWelcomeB2BMail, sendWalletRechargeMail, verifySmtpCredentials } = require('../utils/emailService');
const { metroLabEmailLab, resolveEmailLabForPortal } = require('../utils/emailBranding');
const { validateUniqueLoginEmail, normalizeLoginEmail } = require('../utils/emailUniqueness');
const { validateLoginUser } = require('../utils/loginAuth');
const { uploadBuffer, getSignedUrl, generateFileName, PREFIX } = require('../utils/gcs');

// Files are stored in GCS under this prefix (Cloud Run's container filesystem
// is ephemeral and not shared across instances). Only the flat generated
// filename is persisted in the DB, as before.
const GCS_PREFIX = PREFIX.b2bClients;

const upload = multer({ storage: multer.memoryStorage() });

const uploadFields = upload.fields([
    { name: 'logo_file', maxCount: 1 },
    { name: 'report_header_file', maxCount: 1 },
    { name: 'report_footer_file', maxCount: 1 },
    { name: 'medical_officer_signature_file', maxCount: 1 }
]);

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// Uploads each provided field's file to GCS and returns { [field]: fileName }.
async function persistUploadedFiles(files) {
    const result = {};
    if (!files) return result;
    
    const { isGcsConfigured } = require('../utils/gcs');
    if (!isGcsConfigured()) {
        console.warn('GCS is not configured (missing GCS_BUCKET). Skipping file upload for local development.');
        return result; // Skip GCS upload to avoid crashes locally without credentials
    }
    for (const field of Object.keys(files)) {
        const file = files[field][0];
        const fileName = generateFileName(file.originalname);
        await uploadBuffer(file.buffer, GCS_PREFIX + fileName, file.mimetype);
        result[field] = fileName;
    }
    return result;
}

// GET file helper (public - no auth required)
router.get('/file/:filename', async (req, res) => {
    try {
        const { isGcsConfigured } = require('../utils/gcs');
        if (!isGcsConfigured()) {
            return res.status(404).send('GCS not configured locally. Cannot serve file.');
        }

        const url = await getSignedUrl(GCS_PREFIX + req.params.filename);
        if (String(req.query.json || '') === '1') {
            return resp(res, '200', { url, filename: req.params.filename });
        }
        return res.redirect(url);
    } catch (err) {
        console.error(err);
        return res.status(404).send('File not found');
    }
});

// ── GET /api/B2bClients/whitelabelConfig ────────────────────────
router.get('/whitelabelConfig', async (req, res) => {
    try {
        const { domain } = req.query;
        if (!domain) return resp(res, '400', 'Domain is required');

        const client = await queryOne(
            `SELECT id, company_name, logo_file, primary_color_code, custom_domain 
             FROM b2b_clients 
             WHERE custom_domain = $1 AND deleted = false LIMIT 1`,
            [domain]
        );
        if (!client) return resp(res, '404', 'No whitelabel config found for this domain');

        // Optional: generate signed url for logo if needed
        let logo_url = null;
        if (client.logo_file) {
            const { isGcsConfigured, getSignedUrl } = require('../utils/gcs');
            if (isGcsConfigured()) {
                logo_url = await getSignedUrl(GCS_PREFIX + client.logo_file);
            }
        }

        return resp(res, '200', {
            id: client.id,
            company_name: client.company_name,
            primary_color_code: client.primary_color_code,
            logo_file: client.logo_file,
            logo_url: logo_url,
            custom_domain: client.custom_domain
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── POST /api/B2bClients/login ────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const client = await queryOne(
            `SELECT * FROM b2b_clients WHERE email = $1 AND deleted = false LIMIT 1`,
            [username]
        );
        const auth = await validateLoginUser(client, password);
        if (!auth.ok) return resp(res, auth.code, auth.message);

        const token = jwt.sign(
            { id: auth.user.id, email: auth.user.email, role_id: auth.user.role_id, portal: 'b2b' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: auth.user.id,
            name: auth.user.company_name,
            company_name: auth.user.company_name,
            email: auth.user.email,
            mobile: auth.user.mobile,
            portal: 'b2b',
            token,
            logo_file: auth.user.logo_file || null,
            tagline: auth.user.tagline || null,
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── GET /api/B2bClients/alerts ──────────────────────────────
router.get('/alerts', async (req, res) => {
    try {
        const { b2b_client_id } = req.query;
        let clients = [];

        if (b2b_client_id) {
            const client = await queryOne(`SELECT * FROM b2b_clients WHERE id = $1 AND deleted = false`, [b2b_client_id]);
            if (client) clients.push(client);
        } else {
            const { rows } = await query(`SELECT * FROM b2b_clients WHERE deleted = false`);
            clients = rows;
        }

        const alerts = [];

        for (const client of clients) {
            // Check for subscription alerts
            // 1. Expiring soon (end_date > today, end_date <= today + 2 days)
            // 2. Expired (end_date < today)
            const subscriptions = await query(
                `SELECT * FROM b2b_client_subscription 
                 WHERE b2b_client_id = $1 AND deleted = false
                 ORDER BY end_date DESC`,
                [client.id]
            );

            let hasActiveSub = false;
            let subAlert = null;

            if (subscriptions.rows.length > 0) {
                const latestSub = subscriptions.rows[0];
                const endDate = new Date(latestSub.end_date);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const diffTime = endDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > 2) {
                    hasActiveSub = true;
                } else if (diffDays >= 0 && diffDays <= 2) {
                    hasActiveSub = true;
                    subAlert = {
                        client,
                        type: 'subscription_expiring',
                        message: b2b_client_id 
                            ? `Your subscription expires in ${diffDays} day(s) on ${endDate.toISOString().split('T')[0]}. Please renew soon.`
                            : `Client ${client.company_name}'s subscription expires in ${diffDays} day(s) on ${endDate.toISOString().split('T')[0]}.`
                    };
                } else {
                    subAlert = {
                        client,
                        type: 'subscription_expired',
                        message: b2b_client_id
                            ? `Your subscription expired on ${endDate.toISOString().split('T')[0]}. Please renew or add wallet balance.`
                            : `Client ${client.company_name}'s subscription expired on ${endDate.toISOString().split('T')[0]}.`
                    };
                }
            }

            if (subAlert) {
                alerts.push(subAlert);
            }

            // Wallet balance check if they have NO active subscription (this means they rely on wallet deduction or fixed price from wallet)
            if (!hasActiveSub) {
                const balance = parseFloat(client.wallet_balance || 0);
                if (balance <= 0) {
                    alerts.push({
                        client,
                        type: 'wallet_empty',
                        message: b2b_client_id
                            ? `Your wallet balance is $${balance}. Please add funds to continue booking tests.`
                            : `Client ${client.company_name}'s wallet balance is $${balance}.`
                    });
                }
            }
        }

        return resp(res, '200', alerts);
    } catch (err) { 
        return resp(res, '500', err.message); 
    }
});

// ── GET /api/B2bClients ───────────────────────────────────────
// Optional ?status=true|false — dropdowns use status=true; management lists omit it.
router.get('/', async (req, res) => {
    try {
        let whereClause = 'WHERE deleted = false';
        if (req.query.status !== undefined && String(req.query.status).trim() !== '') {
            const raw = String(req.query.status).trim().toLowerCase();
            if (raw === 'true' || raw === '1' || raw === 'active') {
                whereClause += ' AND status IS DISTINCT FROM false';
            } else if (raw === 'false' || raw === '0' || raw === 'inactive') {
                whereClause += ' AND status = false';
            }
        }
        const { rows } = await query(`SELECT * FROM b2b_clients ${whereClause} ORDER BY id DESC LIMIT 1000`);
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
router.post('/', uploadFields, async (req, res) => {
    try {
        let body = req.body || {};

        const uploaded = await persistUploadedFiles(req.files);
        if (uploaded.logo_file) body.logo_file = uploaded.logo_file;
        if (uploaded.report_header_file) body.report_header_file = uploaded.report_header_file;
        if (uploaded.report_footer_file) body.report_footer_file = uploaded.report_footer_file;
        if (uploaded.medical_officer_signature_file) body.medical_officer_signature_file_name = uploaded.medical_officer_signature_file;

        const {
            role_id, company_name, contact_person_name, mobile, public_phone_no,
            email, public_email, public_fax, address, country_id, state_id, city_id,
            district_id, region_id, pincode, support_mobile, support_email, support_person_name,
            password, tagline, logo_file, report_header_file, report_footer_file,
            primary_color_code, website, medical_officer_name, mrocc, clia_number,
            medical_officer_position, medical_officer_signature_file_name,
            is_approval, approval_note, smtp_server, smtp_port, smtp_email, smtp_password,
            user_id, role_type_id, is_fixed_price, fixed_price_amount, custom_domain
        } = body;

        const emailCheck = await validateUniqueLoginEmail(email);
        if (!emailCheck.ok) return resp(res, emailCheck.code, emailCheck.message);

        if (smtp_server && smtp_port && smtp_email && smtp_password) {
            const smtpCheck = await verifySmtpCredentials(smtp_server, smtp_port, smtp_email, smtp_password);
            if (!smtpCheck.ok) {
                return resp(res, '400', 'Invalid SMTP Credentials: ' + smtpCheck.error);
            }
        }

        const row = await queryOne(
            `INSERT INTO b2b_clients (
                role_id, company_name, contact_person_name, mobile, public_phone_no,
                email, public_email, public_fax, address, country_id, state_id, city_id,
                district_id, region_id, pincode, support_mobile, support_email, support_person_name,
                password, tagline, logo_file, report_header_file, report_footer_file,
                primary_color_code, website, medical_officer_name, mrocc, clia_number,
                medical_officer_position, medical_officer_signature_file_name,
                is_approval, approval_note, smtp_server, smtp_port, smtp_email, smtp_password,
                user_id, role_type_id, status, deleted, is_fixed_price, fixed_price_amount, custom_domain
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
                $37,$38,true,false,$39,$40,$41
            ) RETURNING *`,
            [role_id, company_name, contact_person_name, mobile, public_phone_no,
                normalizeLoginEmail(email), public_email, public_fax, address, country_id, state_id, city_id,
                district_id, region_id, pincode, support_mobile, support_email, support_person_name,
                password, tagline, logo_file, report_header_file, report_footer_file,
                primary_color_code, website, medical_officer_name, mrocc, clia_number,
                medical_officer_position, medical_officer_signature_file_name,
                is_approval, approval_note, smtp_server, smtp_port, smtp_email, smtp_password,
                user_id, role_type_id, is_fixed_price || false, fixed_price_amount || 0, custom_domain]
        );

        if (row && row.email) {
            // Strip smtp fields so the B2B welcome email is sent from the Superadmin (.env) credentials
            // instead of the B2B client's newly added credentials, while preserving their branding.
            const labForEmail = { ...row };
            delete labForEmail.smtp_server;
            delete labForEmail.smtp_port;
            delete labForEmail.smtp_email;
            delete labForEmail.smtp_password;
            
            sendWelcomeB2BMail(row.email, row.company_name, password, labForEmail, metroLabEmailLab()).catch(err => console.error('B2B Email error:', err));
        }

        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── GET /api/B2bClients/dashboardStats ────────────────────────
router.get('/dashboardStats', authMiddleware, async (req, res) => {
    try {
        if (req.user?.portal !== 'b2b') {
            return resp(res, '403', 'Forbidden');
        }

        const { rows } = await query(
            `SELECT COUNT(*)::int AS count
             FROM lab_test_category_report
             WHERE deleted = false AND b2b_client_id = $1`,
            [req.user.id]
        );

        return resp(res, '200', {
            total_completed_tests: rows[0]?.count ?? 0,
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── GET /api/B2bClients/:id ───────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `SELECT id, role_id, company_name, contact_person_name, mobile, public_phone_no,
                    email, public_email, public_fax, address, country_id, state_id, city_id,
                    support_mobile, support_email, support_person_name, tagline, logo_file,
                    primary_color_code, website, smtp_server, smtp_port, smtp_email, smtp_password,
                    status, deleted, wallet_balance, is_fixed_price, fixed_price_amount,
                    pincode, medical_officer_name, medical_officer_position, mrocc, clia_number,
                    is_approval, approval_note, custom_domain
             FROM b2b_clients WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!row) return resp(res, '404', 'B2B Client not found');
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── PUT /api/B2bClients/:id ───────────────────────────────────
router.put('/:id', uploadFields, async (req, res) => {
    try {
        let body = req.body || {};

        const uploaded = await persistUploadedFiles(req.files);
        if (uploaded.logo_file) body.logo_file = uploaded.logo_file;
        if (uploaded.report_header_file) body.report_header_file = uploaded.report_header_file;
        if (uploaded.report_footer_file) body.report_footer_file = uploaded.report_footer_file;
        if (uploaded.medical_officer_signature_file) body.medical_officer_signature_file_name = uploaded.medical_officer_signature_file;

        if (Object.prototype.hasOwnProperty.call(body, 'email') && body.email !== undefined) {
            const emailCheck = await validateUniqueLoginEmail(body.email, {
                table: 'b2b_clients',
                id: req.params.id,
            });
            if (!emailCheck.ok) return resp(res, emailCheck.code, emailCheck.message);
            body.email = normalizeLoginEmail(body.email);
        }

        if (body.smtp_server && body.smtp_port && body.smtp_email && body.smtp_password) {
            const smtpCheck = await verifySmtpCredentials(body.smtp_server, body.smtp_port, body.smtp_email, body.smtp_password);
            if (!smtpCheck.ok) {
                return resp(res, '400', 'Invalid SMTP Credentials: ' + smtpCheck.error);
            }
        }

        const fields = [
            'company_name', 'contact_person_name', 'mobile', 'email', 'address', 'pincode',
            'country_id', 'state_id', 'city_id',
            'public_phone_no', 'public_email', 'public_fax',
            'support_person_name', 'support_mobile', 'support_email',
            'tagline', 'primary_color_code', 'website',
            'medical_officer_name', 'medical_officer_position', 'mrocc', 'clia_number',
            'logo_file', 'report_header_file', 'report_footer_file', 'medical_officer_signature_file_name',
            'smtp_server', 'smtp_port', 'smtp_email', 'smtp_password',
            'is_approval', 'approval_note', 'status', 'is_fixed_price', 'fixed_price_amount', 'custom_domain'
        ];

        const updates = [];
        const values = [];
        let idx = 1;

        for (const key of fields) {
            if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
                let value = body[key];
                if (['country_id', 'state_id', 'city_id'].includes(key) && (value === '' || value === 'null')) {
                    value = null;
                }
                updates.push(`${key} = $${idx++}`);
                values.push(value);
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
                       email, public_email, public_fax, address, country_id, state_id, city_id,
                       support_mobile, support_email, support_person_name, tagline, primary_color_code,
                       website, smtp_server, smtp_port, smtp_email, smtp_password, status, deleted,
                       is_fixed_price, fixed_price_amount`,
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

// ── POST /api/B2bClients/rechargeWallet ────────────────────────────────
router.post('/rechargeWallet', authMiddleware, async (req, res) => {
    try {
        const { b2b_client_id, amount, description } = req.body;
        if (!b2b_client_id || !amount || isNaN(amount) || amount <= 0) {
            return resp(res, '400', 'Invalid recharge amount');
        }

        // We must lock the row or just do an atomic update
        const client = await queryOne(
            `SELECT wallet_balance, company_name, email, tagline, logo_file, report_header_file, smtp_server, smtp_port, smtp_email, smtp_password
             FROM b2b_clients WHERE id = $1`,
            [b2b_client_id]
        );
        if (!client) return resp(res, '404', 'B2B Client not found');

        const newBalance = parseFloat(client.wallet_balance || 0) + parseFloat(amount);

        await query(`UPDATE b2b_clients SET wallet_balance = $1 WHERE id = $2`, [newBalance, b2b_client_id]);

        await query(`
            INSERT INTO b2b_wallet_transactions (b2b_client_id, transaction_type, amount, closing_balance, description, created_by_id)
            VALUES ($1, 'CREDIT', $2, $3, $4, $5)
        `, [b2b_client_id, amount, newBalance, description || 'Manual Recharge', req.user ? req.user.id : null]);

        if (client.email) {
            sendWalletRechargeMail(
                client.email,
                client.company_name,
                amount,
                newBalance.toFixed(2),
                description || 'Manual Recharge',
                resolveEmailLabForPortal(req.user, client)
            ).catch(err => console.error('Wallet recharge email error:', err));
        }

        return resp(res, '200', { message: 'Wallet recharged successfully', newBalance });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── GET /api/B2bClients/walletHistory/:id ────────────────────────────────
router.get('/walletHistory/:id', authMiddleware, async (req, res) => {
    try {
        const { rows } = await query(`
            SELECT * FROM b2b_wallet_transactions 
            WHERE b2b_client_id = $1 
            ORDER BY creation_timestamp DESC
        `, [req.params.id]);
        return resp(res, '200', rows);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
