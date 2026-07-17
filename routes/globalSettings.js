const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// GET all global settings
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { rows } = await query(`SELECT setting_key, setting_value, description FROM global_settings`);
        const settings = {};
        rows.forEach(r => {
            settings[r.setting_key] = { value: r.setting_value, description: r.description };
        });
        return resp(res, '200', settings);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// UPDATE multiple global settings
router.post('/updatePricing', authMiddleware, async (req, res) => {
    try {
        const { prices } = req.body; // e.g. { drug_test_price: '15.00', alcohol_test_price: '20.00', ... }
        if (!prices || typeof prices !== 'object') {
            return resp(res, '400', 'Invalid prices payload');
        }

        const keys = Object.keys(prices);
        for (const key of keys) {
            await query(`
                INSERT INTO global_settings (setting_key, setting_value, updated_timestamp)
                VALUES ($1, $2, NOW())
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_timestamp = NOW()
            `, [key, String(prices[key])]);
        }

        return resp(res, '200', 'Pricing updated successfully');
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
