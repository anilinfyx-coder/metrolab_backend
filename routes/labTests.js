const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── GET /api/LabTests ─────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(`SELECT * FROM lab_tests WHERE deleted = false ORDER BY id DESC`);
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── GET /api/LabTests/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(`SELECT * FROM lab_tests WHERE id = $1 LIMIT 1`, [req.params.id]);
        if (!row) return resp(res, '404', 'Lab test not found');
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── POST /api/LabTests ────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const {
            name, description,
            show_collected_date, show_collected_time, show_received_date, show_received_time,
            show_reported_date, show_reported_time, show_report_status, show_regulation,
            show_specimen, show_final_result, show_requisition_no, show_test_remark,
            show_reason_for_test, show_final_result_disposition, show_final_remark,
            show_date_administered, show_test_date, show_test_time, show_test_performed_by,
            show_fasting, show_device_identifier, show_applied_to, show_lot,
            show_expire_date, show_date_read, show_mm_indurations, show_follow_up,
            default_view, user_id, role_type_id
        } = req.body;

        const row = await queryOne(
            `INSERT INTO lab_tests (name, description,
                show_collected_date, show_collected_time, show_received_date, show_received_time,
                show_reported_date, show_reported_time, show_report_status, show_regulation,
                show_specimen, show_final_result, show_requisition_no, show_test_remark,
                show_reason_for_test, show_final_result_disposition, show_final_remark,
                show_date_administered, show_test_date, show_test_time, show_test_performed_by,
                show_fasting, show_device_identifier, show_applied_to, show_lot,
                show_expire_date, show_date_read, show_mm_indurations, show_follow_up,
                default_view, user_id, role_type_id, status, deleted)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,true,false)
             RETURNING *`,
            [name, description,
             show_collected_date, show_collected_time, show_received_date, show_received_time,
             show_reported_date, show_reported_time, show_report_status, show_regulation,
             show_specimen, show_final_result, show_requisition_no, show_test_remark,
             show_reason_for_test, show_final_result_disposition, show_final_remark,
             show_date_administered, show_test_date, show_test_time, show_test_performed_by,
             show_fasting, show_device_identifier, show_applied_to, show_lot,
             show_expire_date, show_date_read, show_mm_indurations, show_follow_up,
             default_view, user_id, role_type_id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── PUT /api/LabTests/:id ─────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const { name, description, status } = req.body;
        const row = await queryOne(
            `UPDATE lab_tests SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                status = COALESCE($3, status)
             WHERE id = $4 RETURNING *`,
            [name, description, status, req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── DELETE /api/LabTests/:id ──────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `UPDATE lab_tests SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
