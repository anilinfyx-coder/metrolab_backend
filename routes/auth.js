const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

async function passwordMatches(input, stored) {
    if (!stored) return false;
    if (/^\$2[aby]\$/.test(stored)) {
        return bcrypt.compare(input, stored);
    }
    return input === stored;
}

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Check super_admin
        let user = await queryOne(`SELECT * FROM super_admin WHERE email = $1 AND deleted = false AND status = true LIMIT 1`, [username]);
        if (user && await passwordMatches(password, user.password)) {
            const token = jwt.sign({ id: user.id, email: user.email, role_id: user.role_id, role_type_id: user.role_type_id, portal: 'superadmin' }, JWT_SECRET, { expiresIn: '24h' });
            return resp(res, '200', { id: user.id, name: user.name || user.first_name, email: user.email, role: user.role_id, portal: 'superadmin', token });
        }
        
        // Check admin_users
        user = await queryOne(`SELECT * FROM admin_users WHERE email = $1 AND deleted = false AND status = true LIMIT 1`, [username]);
        if (user && await passwordMatches(password, user.password)) {
            const token = jwt.sign({ id: user.id, email: user.email, role_id: user.role_id, role_type_id: user.role_type_id, portal: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
            return resp(res, '200', { id: user.id, name: user.name || user.first_name, email: user.email, role: user.role_id, portal: 'admin', token });
        }
        
        // Check b2b_clients
        user = await queryOne(`SELECT * FROM b2b_clients WHERE email = $1 AND deleted = false AND status = true LIMIT 1`, [username]);
        if (user && await passwordMatches(password, user.password)) {
            const token = jwt.sign({ id: user.id, email: user.email, role_id: user.role_id, role_type_id: user.role_type_id, portal: 'b2b' }, JWT_SECRET, { expiresIn: '24h' });
            return resp(res, '200', { id: user.id, name: user.company_name || user.lab_name || user.first_name, email: user.email, role: user.role_id, portal: 'b2b', token });
        }
        
        // Check corporate_clients
        user = await queryOne(`SELECT * FROM corporate_clients WHERE email = $1 AND deleted = false AND status = true LIMIT 1`, [username]);
        if (user && await passwordMatches(password, user.password)) {
            const token = jwt.sign({ id: user.id, email: user.email, role_id: user.role_id, role_type_id: user.role_type_id, portal: 'corporate' }, JWT_SECRET, { expiresIn: '24h' });
            return resp(res, '200', { id: user.id, name: user.company_name || user.first_name, email: user.email, role: user.role_id, portal: 'corporate', token });
        }
        
        return resp(res, '401', 'Invalid credentials');

    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
