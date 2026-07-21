const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

router.use(authMiddleware);

async function resolveAdminContext(userId) {
    const admin = await queryOne(
        `SELECT id, user_id, role_type_id
         FROM admin_users
         WHERE id = $1 AND deleted = false
         LIMIT 1`,
        [userId]
    );
    return {
        b2b_client_id: admin?.user_id || null,
        user_id: admin?.user_id || userId,
        role_type_id: admin?.role_type_id || null,
    };
}

// GET /api/WaitingList — all with patient info + linked tests
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(`
            SELECT wl.*,
                   p.name as patient_name, p.mobile as patient_mobile, p.dob as patient_dob,
                   p.ssn as patient_ssn, p.uid as patient_uid,
                   COALESCE((
                     SELECT string_agg(lt.name, '. ' ORDER BY lt.id)
                     FROM waiting_test_lab_test wtl
                     JOIN lab_tests lt ON lt.id = wtl.lab_test_id
                     WHERE wtl.waiting_list_id = wl.id AND wtl.deleted = false
                   ), '') AS tests,
                   COALESCE((
                     SELECT COUNT(*)::int
                     FROM waiting_test_lab_test wtl
                     WHERE wtl.waiting_list_id = wl.id AND wtl.deleted = false
                   ), 0) AS test_count
            FROM waiting_list wl
            LEFT JOIN patient p ON p.id = wl.patient_id
            WHERE wl.deleted = false
            ORDER BY wl.id DESC
        `);
        return resp(res, '200', rows);
    } catch (err) { return resp(res, '500', err.message); }
});

// GET /api/WaitingList/patient/:patientId/history
// One row per assigned test, including the generated report when available.
router.get('/patient/:patientId/history', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT
                wtl.id,
                wl.id AS waiting_list_id,
                wl.creation_timestamp,
                wl.reason_for_test,
                lt.id AS lab_test_id,
                lt.name AS lab_test_name,
                report.id AS report_id,
                report.uid AS report_uid,
                report.status AS report_status
             FROM waiting_list wl
             JOIN waiting_test_lab_test wtl
               ON wtl.waiting_list_id = wl.id
              AND wtl.deleted = false
             JOIN lab_tests lt
               ON lt.id = wtl.lab_test_id
              AND lt.deleted = false
             LEFT JOIN LATERAL (
                SELECT r.id, r.uid, r.status
                FROM lab_test_category_report r
                WHERE r.waiting_list_id = wl.id
                  AND r.lab_test_id = wtl.lab_test_id
                  AND r.deleted = false
                ORDER BY r.id DESC
                LIMIT 1
             ) report ON true
             WHERE wl.patient_id = $1
               AND wl.deleted = false
             ORDER BY wl.creation_timestamp DESC, wtl.id DESC`,
            [req.params.patientId]
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// GET /api/WaitingList/:id
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `SELECT wl.*, p.name as patient_name, p.mobile as patient_mobile, p.gender as patient_gender,
                    p.dob as patient_dob, p.ssn as patient_ssn, p.email as patient_email, 
                    p.street1 as patient_street1, p.street2 as patient_street2, p.city as patient_city,
                    p.state as patient_state, p.zipcode as patient_zipcode, p.driving_license as patient_dl,
                    p.driving_license_state as patient_dl_state, p.uid as patient_uid
             FROM waiting_list wl LEFT JOIN patient p ON p.id = wl.patient_id
             WHERE wl.id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!row) return resp(res, '404', 'Waiting list entry not found');

        // Get linked lab tests and their detailed structures
        const { rows: tests } = await query(
            `SELECT wtl.id as waiting_test_id, wtl.status as waiting_test_status, lt.*
             FROM waiting_test_lab_test wtl
             JOIN lab_tests lt ON lt.id = wtl.lab_test_id
             WHERE wtl.waiting_list_id = $1 AND wtl.deleted = false`,
            [req.params.id]
        );

        for (let i = 0; i < tests.length; i++) {
            const testId = tests[i].id;
            
            // Check if test report is already submitted
            const existingReport = await queryOne(`SELECT id FROM lab_test_category_report WHERE waiting_list_id = $1 AND lab_test_id = $2 LIMIT 1`, [row.id, testId]);
            tests[i].submitStatus = existingReport ? true : false;
            
            // Get questions (enabled only — disabled questions hidden system-wide)
            const { rows: questions } = await query(
                `SELECT * FROM report_questions
                 WHERE lab_test_id = $1 AND deleted = false AND status IS DISTINCT FROM false
                 ORDER BY id ASC`,
                [testId]
            );
            tests[i].testReportQuestionList = questions;

            // Get parameters (enabled only)
            const { rows: parameters } = await query(
                `SELECT * FROM report_request_parameters
                 WHERE lab_test_id = $1 AND deleted = false AND status IS DISTINCT FROM false
                 ORDER BY id ASC`,
                [testId]
            );
            tests[i].testResultParameterList = parameters;

            // Get mapped specimen types (enabled links + enabled specimen types only)
            const { rows: specimens } = await query(
                `SELECT DISTINCT st.*
                 FROM specimen_type_drug_linking stdl
                 JOIN specimen_type st ON st.id = stdl.specimen_type_id
                 WHERE stdl.lab_test_id = $1
                   AND stdl.deleted = false
                   AND stdl.status IS DISTINCT FROM false
                   AND st.deleted = false
                   AND st.status IS DISTINCT FROM false
                 ORDER BY st.name ASC`,
                [testId]
            );
            tests[i].specimenTypeList = specimens;
        }

        return resp(res, '200', { ...row, labTestList: tests });
    } catch (err) { return resp(res, '500', err.message); }
});

// POST /api/WaitingList — save patient + waiting list together
router.post('/', async (req, res) => {
    try {
        const {
            patient_id, b2b_client_id, uid, reason_for_test, requisition_no,
            corporate_client_id, employee_id, lab_test_ids, user_id, role_type_id
        } = req.body;

        const ctx = req.user?.id ? await resolveAdminContext(req.user.id) : null;
        let wlUid = uid;
        let wlB2b = b2b_client_id || ctx?.b2b_client_id || null;
        let wlUserId = user_id || ctx?.user_id || null;
        let wlRoleType = role_type_id || ctx?.role_type_id || null;

        if (patient_id) {
            const pat = await queryOne(
                `SELECT uid, b2b_client_id, user_id, role_type_id FROM patient WHERE id = $1 LIMIT 1`,
                [patient_id]
            );
            if (pat) {
                if (!wlUid) wlUid = pat.uid;
                if (!wlB2b) wlB2b = pat.b2b_client_id;
                if (!wlUserId) wlUserId = pat.user_id;
                if (!wlRoleType) wlRoleType = pat.role_type_id;
            }
        }

        const wl = await queryOne(
            `INSERT INTO waiting_list 
                (patient_id, b2b_client_id, uid, reason_for_test, requisition_no,
                 corporate_client_id, employee_id, user_id, role_type_id, status, deleted, creation_timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,NOW()) RETURNING *`,
            [patient_id, wlB2b, wlUid, reason_for_test, requisition_no,
             corporate_client_id, employee_id, wlUserId, wlRoleType]
        );

        // Link lab tests
        if (lab_test_ids && lab_test_ids.length > 0) {
            for (const lab_test_id of lab_test_ids) {
                await queryOne(
                    `INSERT INTO waiting_test_lab_test 
                        (waiting_list_id, lab_test_id, b2b_client_id, status, deleted, creation_timestamp)
                     VALUES ($1,$2,$3,true,false,NOW())`,
                    [wl.id, lab_test_id, wlB2b]
                );
            }
        }

        return resp(res, '200', wl);
    } catch (err) { return resp(res, '500', err.message); }
});

// PUT /api/WaitingList/:id
router.put('/:id', async (req, res) => {
    try {
        const { reason_for_test, requisition_no, status } = req.body;
        const row = await queryOne(
            `UPDATE waiting_list SET
                reason_for_test = COALESCE($1, reason_for_test),
                requisition_no = COALESCE($2, requisition_no),
                status = COALESCE($3, status)
             WHERE id = $4 RETURNING *`,
            [reason_for_test, requisition_no, status, req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// DELETE /api/WaitingList/:id
router.delete('/:id', async (req, res) => {
    try {
        const row = await queryOne(
            `UPDATE waiting_list SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
