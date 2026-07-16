const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { sendSubscriptionPurchaseMail } = require('../utils/emailService');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// GET /api/B2bClientSubscription?b2b_client_id=X
router.get('/', async (req, res) => {
    try {
        const { b2b_client_id } = req.query;
        let sql = `SELECT * FROM b2b_client_subscription WHERE deleted = false`;
        const params = [];
        if (b2b_client_id) {
            params.push(b2b_client_id);
            sql += ` AND b2b_client_id = $${params.length}`;
        }
        sql += ` ORDER BY id DESC`;
        const { rows } = await query(sql, params);
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// GET /api/B2bClientSubscription/:id
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(`SELECT * FROM b2b_client_subscription WHERE id = $1 LIMIT 1`, [req.params.id]);
        if (!row) return resp(res, '404', 'Not found');
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// POST /api/B2bClientSubscription
router.post('/', async (req, res) => {
    try {
        const { b2b_client_id, start_date, end_date, amount } = req.body;
        const row = await queryOne(
            `INSERT INTO b2b_client_subscription (b2b_client_id, start_date, end_date, amount, status, deleted)
             VALUES ($1, $2, $3, $4, true, false) RETURNING *`,
            [b2b_client_id, start_date, end_date, amount]
        );

        const b2bClient = await queryOne('SELECT email FROM b2b_clients WHERE id = $1', [b2b_client_id]);
        if (b2bClient && b2bClient.email) {
            sendSubscriptionPurchaseMail(b2bClient.email, amount, start_date, end_date).catch(err => console.error('Subscription Email error:', err));
        }

        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// PUT /api/B2bClientSubscription/:id
router.put('/:id', async (req, res) => {
    try {
        const { start_date, end_date, amount } = req.body;
        const row = await queryOne(
            `UPDATE b2b_client_subscription SET
                start_date = COALESCE($1, start_date),
                end_date = COALESCE($2, end_date),
                amount = COALESCE($3, amount)
             WHERE id = $4 RETURNING *`,
            [start_date, end_date, amount, req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// DELETE /api/B2bClientSubscription/:id
router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `UPDATE b2b_client_subscription SET deleted = true WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
