const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// GET /api/B2bClientCustomPrices?b2b_client_id=X
router.get('/', async (req, res) => {
    try {
        const { b2b_client_id } = req.query;
        if (!b2b_client_id) return resp(res, '400', 'b2b_client_id is required');

        const { rows } = await query(
            `SELECT * FROM b2b_client_custom_prices WHERE b2b_client_id = $1`, 
            [b2b_client_id]
        );
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// POST /api/B2bClientCustomPrices/bulk
router.post('/bulk', async (req, res) => {
    try {
        const { b2b_client_id, custom_prices } = req.body;
        // custom_prices should be an array of { lab_test_id, custom_price }
        if (!b2b_client_id) return resp(res, '400', 'b2b_client_id is required');

        // Note: For simplicity, we just clear and re-insert the specific ones provided.
        // But since they might just want to update/insert, let's use ON CONFLICT
        
        for (const item of (custom_prices || [])) {
            if (item.custom_price !== null && item.custom_price !== undefined && item.custom_price !== '') {
                // Upsert
                await query(`
                    INSERT INTO b2b_client_custom_prices (b2b_client_id, lab_test_id, custom_price)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (b2b_client_id, lab_test_id) 
                    DO UPDATE SET custom_price = EXCLUDED.custom_price
                `, [b2b_client_id, item.lab_test_id, item.custom_price]);
            } else {
                // Delete if price is empty
                await query(`
                    DELETE FROM b2b_client_custom_prices 
                    WHERE b2b_client_id = $1 AND lab_test_id = $2
                `, [b2b_client_id, item.lab_test_id]);
            }
        }

        return resp(res, '200', 'Custom prices saved successfully.');
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
