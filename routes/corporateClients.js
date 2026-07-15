const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { crudRoutes } = require('./crud');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── POST /api/CorporateClients/login ────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // Corporate login uses email as username
        const client = await queryOne(
            `SELECT * FROM corporate_clients WHERE email = $1 AND deleted = false AND status = true LIMIT 1`,
            [username]
        );
        if (!client) return resp(res, '404', 'Corporate Client not found');

        let isMatch = false;
        if (client.password.startsWith('$2a$') || client.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, client.password);
        } else {
            isMatch = (password === client.password);
        }
        
        if (!isMatch) return resp(res, '401', 'Invalid credentials');

        const token = jwt.sign(
            { id: client.id, email: client.email, role_id: client.role_id, portal: 'corporate' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: client.id, name: client.company_name, email: client.email,
            mobile: client.mobile, portal: 'corporate', token
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── POST /api/CorporateClients ────────────────────────
router.post('/', async (req, res) => {
    try {
        const {
            role_id, b2b_client_id, company_name, contact_person_name, mobile, email,
            address, country_id, state_id, city_id, district_id, region_id, pincode,
            password, verification_status
        } = req.body;

        const hashedPassword = password ? await bcrypt.hash(password, 10) : '';

        const row = await queryOne(
            `INSERT INTO corporate_clients (
                role_id, b2b_client_id, company_name, contact_person_name, mobile, email,
                address, country_id, state_id, city_id, district_id, region_id, pincode,
                password, verification_status, status, deleted
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,false
            ) RETURNING *`,
            [role_id || 3, b2b_client_id, company_name, contact_person_name, mobile, email,
             address, country_id, state_id, city_id, district_id, region_id, pincode,
             hashedPassword, verification_status || false]
        );
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── PUT /api/CorporateClients/:id ─────────────────────
router.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body;
        
        let updates = [];
        let values = [];
        let idx = 1;

        if (body.password) {
            body.password = await bcrypt.hash(body.password, 10);
        }

        for (const [key, value] of Object.entries(body)) {
            updates.push(`${key} = $${idx}`);
            values.push(value);
            idx++;
        }
        
        if (updates.length === 0) return resp(res, '400', 'No fields to update');
        
        values.push(id);
        const q = `UPDATE corporate_clients SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
        const row = await queryOne(q, values);
        if (!row) return resp(res, '404', 'Not found');
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// Append generic CRUD routes (for GET and DELETE)
router.use('/', crudRoutes('corporate_clients'));

module.exports = router;
