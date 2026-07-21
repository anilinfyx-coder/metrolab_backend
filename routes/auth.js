const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { authenticateByEmail } = require('../utils/loginAuth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

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
                        `SELECT company_name, tagline, logo_file FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
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

module.exports = router;
