const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { authenticateByEmail } = require('../utils/loginAuth');
const { sendPasswordResetMail } = require('../utils/emailService');
const { getFrontendBaseUrl } = require('../utils/frontendUrl');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

const ACCOUNT_TABLES = [
    { table: 'super_admin', nameFields: ['name', 'first_name'] },
    { table: 'admin_users', nameFields: ['name', 'first_name'] },
    { table: 'b2b_clients', nameFields: ['company_name', 'contact_person_name'] },
    { table: 'corporate_clients', nameFields: ['company_name', 'contact_person_name'] },
];

const GENERIC_FORGOT_MESSAGE =
    'If an account exists for that email, a password reset link has been sent.';

function pickDisplayName(user, nameFields) {
    for (const field of nameFields) {
        const value = user?.[field];
        if (value != null && String(value).trim()) return String(value).trim();
    }
    return 'User';
}

async function findAccountByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;

    for (const entry of ACCOUNT_TABLES) {
        const user = await queryOne(
            `SELECT * FROM ${entry.table} WHERE LOWER(email) = $1 AND deleted = false LIMIT 1`,
            [normalized]
        );
        if (!user) continue;
        if (user.status === false) {
            return { user, ...entry, disabled: true };
        }
        return { user, ...entry, disabled: false };
    }
    return null;
}

async function resolveLabBranding(account) {
    if (!account?.user) return null;

    if (account.table === 'b2b_clients') {
        return {
            company_name: account.user.company_name,
            tagline: account.user.tagline,
            logo_file: account.user.logo_file,
            report_header_file: account.user.report_header_file,
            smtp_server: account.user.smtp_server,
            smtp_port: account.user.smtp_port,
            smtp_email: account.user.smtp_email,
            smtp_password: account.user.smtp_password,
        };
    }

    if (account.table === 'corporate_clients' && account.user.b2b_client_id) {
        return queryOne(
            `SELECT company_name, tagline, logo_file, report_header_file, smtp_server, smtp_port, smtp_email, smtp_password
             FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
            [account.user.b2b_client_id]
        );
    }

    if (account.table === 'admin_users' && account.user.user_id) {
        return queryOne(
            `SELECT company_name, tagline, logo_file, report_header_file, smtp_server, smtp_port, smtp_email, smtp_password
             FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
            [account.user.user_id]
        );
    }

    return null;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function isValidNewPassword(password) {
    if (!password || String(password).length < 6) return false;
    if (/[^a-zA-Z0-9@#]/.test(String(password))) return false;
    return true;
}

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return resp(res, '400', 'Username and password are required');
        }

        const tables = [
            'super_admin',
            'admin_users',
            'b2b_clients',
            'corporate_clients',
        ];

        let lastError = null;

        for (const table of tables) {
            const attempt = await authenticateByEmail(queryOne, table, username, password);
            if (!attempt.found) continue;

            const { result } = attempt;
            if (!result.ok) {
                lastError = { code: result.code, message: result.message };
                continue;
            }

            const user = result.user;
            let portal;
            let payload;

            if (table === 'super_admin') {
                portal = 'superadmin';
                payload = {
                    id: user.id,
                    name: user.name || user.first_name,
                    email: user.email,
                    role: user.role_id,
                    portal,
                };
            } else if (table === 'admin_users') {
                portal = 'admin';
                let b2bBranding = null;
                if (user.user_id) {
                    b2bBranding = await queryOne(
                        `SELECT company_name, tagline, logo_file, report_header_file, smtp_server, smtp_port, smtp_email, smtp_password FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
                        [user.user_id]
                    );
                }
                payload = {
                    id: user.id,
                    name: user.name || user.first_name,
                    email: user.email,
                    role: user.role_id,
                    portal,
                    user_id: user.user_id || null,
                    company_name: b2bBranding?.company_name || null,
                    tagline: b2bBranding?.tagline || null,
                    logo_file: b2bBranding?.logo_file || null,
                };
            } else if (table === 'b2b_clients') {
                portal = 'b2b';
                payload = {
                    id: user.id,
                    name: user.company_name || user.lab_name || user.first_name,
                    company_name: user.company_name,
                    email: user.email,
                    role: user.role_id,
                    portal,
                    logo_file: user.logo_file || null,
                    tagline: user.tagline || null,
                };
            } else {
                portal = 'corporate';
                payload = {
                    id: user.id,
                    name: user.company_name || user.first_name,
                    email: user.email,
                    role: user.role_id,
                    portal,
                };
            }

            const token = jwt.sign(
                {
                    id: user.id,
                    email: user.email,
                    role_id: user.role_id,
                    role_type_id: user.role_type_id,
                    portal,
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            res.setHeader('token', token);
            return resp(res, '200', { ...payload, token });
        }

        if (lastError) {
            return resp(res, lastError.code, lastError.message);
        }

        return resp(res, '401', 'Invalid credentials');
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST /api/Auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return resp(res, '400', 'Email address is required');
        }

        const account = await findAccountByEmail(email);

        // Always return the same message to avoid account enumeration
        if (!account || account.disabled) {
            return resp(res, '200', GENERIC_FORGOT_MESSAGE);
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Invalidate previous unused tokens for this account
        await query(
            `UPDATE password_reset_tokens
             SET used_at = NOW()
             WHERE email = $1 AND account_table = $2 AND account_id = $3 AND used_at IS NULL`,
            [email, account.table, account.user.id]
        );

        await query(
            `INSERT INTO password_reset_tokens (email, account_table, account_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [email, account.table, account.user.id, tokenHash, expiresAt]
        );

        const resetUrl = `${getFrontendBaseUrl()}/reset-password/${encodeURIComponent(rawToken)}`;

        const displayName = pickDisplayName(account.user, account.nameFields);
        const lab = await resolveLabBranding(account);

        const sent = await sendPasswordResetMail(email, displayName, resetUrl, lab);
        if (!sent) {
            console.error('Forgot password: SMTP failed for', email);
            return resp(res, '500', 'Unable to send reset email. Please try again later.');
        }

        return resp(res, '200', GENERIC_FORGOT_MESSAGE);
    } catch (err) {
        console.error('forgot-password error:', err);
        return resp(res, '500', err.message || 'Unable to process password reset request');
    }
});

// POST /api/Auth/reset-password
router.post('/reset-password', async (req, res) => {
    try {
        const token = String(req.body?.token || '').trim();
        const emailHint = String(req.body?.email || '').trim().toLowerCase();
        const newPassword = String(req.body?.newPassword || req.body?.password || '');

        if (!token) {
            return resp(res, '400', 'Invalid or missing reset token.');
        }
        if (!isValidNewPassword(newPassword)) {
            return resp(
                res,
                '400',
                'Password must be at least 6 characters. Only @ and # are allowed as special characters.'
            );
        }

        const tokenHash = hashToken(token);
        const resetRow = await queryOne(
            `SELECT * FROM password_reset_tokens
             WHERE token_hash = $1
             LIMIT 1`,
            [tokenHash]
        );

        if (!resetRow) {
            return resp(res, '400', 'Invalid or expired reset link. Please request a new one.');
        }
        if (emailHint && String(resetRow.email || '').toLowerCase() !== emailHint) {
            return resp(res, '400', 'Invalid or expired reset link. Please request a new one.');
        }
        if (resetRow.used_at) {
            return resp(res, '400', 'This reset link has already been used. Please request a new one.');
        }
        if (new Date(resetRow.expires_at).getTime() < Date.now()) {
            return resp(res, '400', 'This reset link has expired. Please request a new one.');
        }

        const allowedTables = ACCOUNT_TABLES.map(t => t.table);
        if (!allowedTables.includes(resetRow.account_table)) {
            return resp(res, '400', 'Invalid reset request.');
        }

        const email = String(resetRow.email || '').toLowerCase();
        const user = await queryOne(
            `SELECT id, email, status, deleted FROM ${resetRow.account_table}
             WHERE id = $1 AND LOWER(email) = $2 AND deleted = false
             LIMIT 1`,
            [resetRow.account_id, email]
        );
        if (!user) {
            return resp(res, '404', 'Account not found.');
        }
        if (user.status === false) {
            return resp(res, '403', 'Your account has been disabled. Please contact your administrator.');
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await query(
            `UPDATE ${resetRow.account_table} SET password = $1 WHERE id = $2`,
            [hashed, user.id]
        );

        await query(
            `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
            [resetRow.id]
        );

        // Invalidate any other unused tokens for this account
        await query(
            `UPDATE password_reset_tokens
             SET used_at = NOW()
             WHERE email = $1 AND account_table = $2 AND account_id = $3 AND used_at IS NULL`,
            [email, resetRow.account_table, resetRow.account_id]
        );

        return resp(res, '200', 'Your password has been successfully reset.');
    } catch (err) {
        console.error('reset-password error:', err);
        return resp(res, '500', err.message || 'Unable to reset password');
    }
});

module.exports = router;
