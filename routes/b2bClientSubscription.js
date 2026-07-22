const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { sendSubscriptionPurchaseMail } = require('../utils/emailService');
const { B2B_BRANDING_SELECT, metroLabEmailLab } = require('../utils/emailBranding');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

async function fetchLabBranding(b2bClientId) {
    if (!b2bClientId) return null;
    return queryOne(
        `SELECT ${B2B_BRANDING_SELECT} FROM b2b_clients WHERE id = $1 LIMIT 1`,
        [b2bClientId]
    );
}

async function notifySubscriptionPurchase(b2bClientId, amount, startDate, endDate) {
    const lab = await fetchLabBranding(b2bClientId);
    if (!lab?.email) return;

    // Subscriptions are managed from Super Admin — Metro Lab default logo
    sendSubscriptionPurchaseMail(
        lab.email,
        lab.company_name,
        amount,
        startDate,
        endDate,
        metroLabEmailLab()
    ).catch(err => console.error('Subscription Email error:', err));
}

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

// GET /api/B2bClientSubscription/active — currently active subscriptions (for dashboard)
router.get('/active', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
        const { rows } = await query(
            `SELECT s.id,
                    s.b2b_client_id,
                    s.start_date,
                    s.end_date,
                    s.amount,
                    s.creation_timestamp,
                    s.status,
                    b.company_name,
                    b.contact_person_name,
                    b.email,
                    b.mobile
             FROM b2b_client_subscription s
             INNER JOIN b2b_clients b ON b.id = s.b2b_client_id AND b.deleted = false
             WHERE s.deleted = false
               AND s.status IS DISTINCT FROM false
               AND s.start_date <= CURRENT_DATE
               AND s.end_date >= CURRENT_DATE
             ORDER BY s.end_date ASC, s.id DESC
             LIMIT $1`,
            [limit]
        );
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

        await notifySubscriptionPurchase(b2b_client_id, amount, start_date, end_date);

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

        if (row) {
            await notifySubscriptionPurchase(
                row.b2b_client_id,
                row.amount,
                row.start_date,
                row.end_date
            );
        }

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
