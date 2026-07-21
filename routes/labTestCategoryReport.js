const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const {
    applyDisplayOptionsToLabTest,
    loadB2bLabTestAccess,
    resolveOwnerB2bClientId,
} = require('../utils/labTestDisplayOptions');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

router.use(authMiddleware);

// GET all reports (replaces crudRoutes GET /)
router.get('/', async (req, res) => {
    try {
        let whereClause = 'WHERE r.deleted = false';
        const values = [];
        let index = 1;

        const filterable = ['lab_test_id', 'drug_id', 'b2b_client_id', 'corporate_client_id', 'specimen_type_id'];
        for (const key of filterable) {
            if (req.query[key] !== undefined && req.query[key] !== '') {
                whereClause += ` AND r.${key} = $${index++}`;
                values.push(req.query[key]);
            }
        }

        const { resolveAdminContext } = require('../utils/adminContext');
        if (req.user && req.user.portal === 'b2b') {
            whereClause += ` AND r.b2b_client_id = $${index++}`;
            values.push(req.user.id);
        } else if (req.user && req.user.portal === 'corporate') {
            whereClause += ` AND r.corporate_client_id = $${index++}`;
            values.push(req.user.id);
        } else if (req.user && req.user.portal === 'admin') {
            const ctx = await resolveAdminContext(req.user.id);
            if (ctx.b2b_client_id) {
                whereClause += ` AND r.b2b_client_id = $${index++}`;
                values.push(ctx.b2b_client_id);
            } else if (ctx.corporate_client_id) {
                whereClause += ` AND r.corporate_client_id = $${index++}`;
                values.push(ctx.corporate_client_id);
            }
        }

        const { rows } = await query(
            `SELECT r.*,
                    p.name as patient_name,
                    p.email as patient_email,
                    p.uid as patient_uid,
                    l.name as lab_test_name,
                    COALESCE(NULLIF(TRIM(r.uid), ''), p.uid) as uid
             FROM lab_test_category_report r
             LEFT JOIN patient p ON p.id = r.patient_id
             LEFT JOIN lab_tests l ON l.id = r.lab_test_id
             ${whereClause}
             ORDER BY r.id DESC`,
            values
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// GET report by ID (replaces crudRoutes GET /:id)
router.get('/:id', async (req, res) => {
    try {
        const row = await queryOne(`SELECT * FROM lab_test_category_report WHERE id = $1 LIMIT 1`, [req.params.id]);
        if (!row) return resp(res, '404', `Report not found`);
        return resp(res, '200', row);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// PUT update report (replaces crudRoutes PUT /:id)
router.put('/:id', async (req, res) => {
    try {
        const updates = [];
        const values = [];
        let index = 1;
        for (const key in req.body) {
            updates.push(`${key} = $${index++}`);
            values.push(req.body[key]);
        }
        if (updates.length === 0) return resp(res, '400', 'No fields to update');

        values.push(req.params.id);
        const q = `UPDATE lab_test_category_report SET ${updates.join(', ')} WHERE id = $${index} RETURNING *`;
        const updated = await queryOne(q, values);
        return resp(res, '200', updated);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── CUSTOM OLD UI COMPATIBLE ROUTES ──────────────────────────────────────────

// POST getLabTestCategoryReportDetails
router.post('/getLabTestCategoryReportDetails', async (req, res) => {
    try {
        await query(`ALTER TABLE lab_test_category_report ADD COLUMN IF NOT EXISTS b2b_client_id INT`);
        await query(`ALTER TABLE lab_test_category_report ADD COLUMN IF NOT EXISTS corporate_client_id INT`);

        const { id } = req.body;

        const report = await queryOne(`
            SELECT r.*, l.name as lab_test_name
            FROM lab_test_category_report r
            LEFT JOIN lab_tests l ON r.lab_test_id = l.id
            WHERE r.id = $1
        `, [id]);

        if (!report) {
            return res.status(404).json({ response_code: '404', obj: 'Report not found' });
        }

        const labTest = await queryOne(`SELECT * FROM lab_tests WHERE id = $1`, [report.lab_test_id]);
        // Resolve owning B2B from report → waiting list → patient → corporate
        const b2bClientId = await resolveOwnerB2bClientId({
            b2b_client_id: report.b2b_client_id,
            waiting_list_id: report.waiting_list_id,
            patient_id: report.patient_id,
            corporate_client_id: report.corporate_client_id,
            lab_test_id: report.lab_test_id,
            created_by_id: report.created_by_id,
        });
        if (b2bClientId) {
            const access = await loadB2bLabTestAccess(b2bClientId, report.lab_test_id);
            report.labTest = applyDisplayOptionsToLabTest(labTest, access);
        } else {
            report.labTest = applyDisplayOptionsToLabTest(labTest, null);
        }
        report.resolved_b2b_client_id = b2bClientId;

        const questionFilter = b2bClientId
            ? `rq.lab_test_id = $2 AND rq.deleted = false AND (rq.b2b_client_id = $3 OR rq.b2b_client_id IS NULL)`
            : `rq.lab_test_id = $2 AND rq.deleted = false`;
        const questionParams = b2bClientId ? [id, report.lab_test_id, b2bClientId] : [id, report.lab_test_id];
        const questionsQuery = `
            SELECT
                rq.id as report_question_id,
                rq.question_text,
                rq.description,
                rq.answer_type,
                rq.answer_option,
                a.id as answer_id,
                COALESCE(a.value, '') as value
            FROM report_questions rq
            LEFT JOIN lab_test_category_report_question_answer a
                ON a.report_questions_id = rq.id
               AND a.lab_test_category_report_id = $1
               AND a.deleted = false               
            WHERE ${questionFilter}
                AND rq.status IS DISTINCT FROM false
            ORDER BY rq.id ASC
        `;
        const { rows: questions } = await query(questionsQuery, questionParams);
        report.testReportQuestionList = questions;

        const paramFilter = b2bClientId
            ? `rp.lab_test_id = $2 AND rp.deleted = false AND (rp.b2b_client_id = $3 OR rp.b2b_client_id IS NULL)`
            : `rp.lab_test_id = $2 AND rp.deleted = false`;
        const paramParams = b2bClientId ? [id, report.lab_test_id, b2bClientId] : [id, report.lab_test_id];
        const parametersQuery = `
            SELECT
                rp.id as report_request_parameters_id,
                rp.name,
                rp.label,
                rp.description,
                rp.placeholder,
                rp.input_type,
                rp.input_option,
                rp.unit_text,
                rp.screening_cutoff,
                rp.confirmation_cutoff,
                rp.is_mandatory,
                a.id as answer_id,
                COALESCE(a.value, '') as value
            FROM report_request_parameters rp
            LEFT JOIN lab_test_category_report_request_parameter_value a
                ON a.report_request_parameters_id = rp.id
               AND a.lab_test_category_report_id = $1
               AND a.deleted = false                          
            WHERE ${paramFilter}
                AND rp.status IS DISTINCT FROM false
            ORDER BY rp.id ASC
        `;
        const { rows: parameters } = await query(parametersQuery, paramParams);
        report.testResultParameterList = parameters;

        const specimenFilter = b2bClientId
            ? `stdl.lab_test_id = $1 AND stdl.deleted = false AND st.deleted = false AND (stdl.b2b_client_id = $2 OR stdl.b2b_client_id IS NULL)`
            : `stdl.lab_test_id = $1 AND stdl.deleted = false AND st.deleted = false`;
        const specimenParams = b2bClientId ? [report.lab_test_id, b2bClientId] : [report.lab_test_id];
        const { rows: specimens } = await query(
            `SELECT DISTINCT st.*
             FROM specimen_type_drug_linking stdl
             JOIN specimen_type st ON st.id = stdl.specimen_type_id
             WHERE ${specimenFilter}
             AND stdl.status IS DISTINCT FROM false              
               AND st.status IS DISTINCT FROM false
             ORDER BY st.name ASC`,
            specimenParams
        );
        report.specimenTypeList = specimens;

        return resp(res, '200', report);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST saveLabTestCategoryReport
router.post('/saveLabTestCategoryReport', async (req, res) => {
    try {
        const data = req.body;
        const id = data.id;

        const combineDateTime = (dateVal, timeVal, fallback) => {
            if (dateVal && timeVal) return `${dateVal} ${timeVal}`;
            if (dateVal) return dateVal;
            if (fallback) return fallback;
            return null;
        };

        const collectedTs = combineDateTime(data.collected_date, data.collected_time, data.collected_timestamp);
        const receivedTs = combineDateTime(data.received_date, data.received_time, data.received_timestamp);
        const reportedTs = combineDateTime(data.reported_date, data.reported_time, data.reported_timestamp);

        await queryOne(`
            UPDATE lab_test_category_report
            SET
                regulation = COALESCE($1, regulation),
                specimen_type_id = $2,
                collected_timestamp = $3,
                received_timestamp = $4,
                reported_timestamp = $5,
                date_of_test = $6,
                test_performed_by = $7,
                reason_for_test = $8,
                final_result = $9,
                test_remark = $10,
                report_status = $11,
                final_remark = $12,
                test_result = $13,
                fasting = COALESCE($14, fasting),
                requisition_no = COALESCE($15, requisition_no),
                device_identifier = COALESCE($16, device_identifier),
                lot = COALESCE($17, lot),
                expiry_date = $18,
                date_read = $19,
                mm_indurations = COALESCE($20, mm_indurations),
                follow_up = COALESCE($21, follow_up),
                final_result_disposition = COALESCE($22, final_result_disposition),
                date_administered = $23,
                applied_to_arm = COALESCE($24, applied_to_arm),
                reference_range_note = COALESCE($25, reference_range_note),
                clinical_significance_note = COALESCE($26, clinical_significance_note),
                result_interpretation_note = COALESCE($27, result_interpretation_note)
            WHERE id = $28
        `, [
            data.regulation || null,
            data.specimen_type_id || null,
            collectedTs,
            receivedTs,
            reportedTs,
            data.date_of_test || null,
            data.test_performed_by || null,
            data.reason_for_test || null,
            data.final_result || null,
            data.test_remark || null,
            data.report_status || null,
            data.final_remark || null,
            data.test_result || null,
            data.fasting || null,
            data.requisition_no || null,
            data.device_identifier || null,
            data.lot || null,
            data.expiry_date || null,
            data.date_read || null,
            data.mm_indurations || null,
            data.follow_up || null,
            data.final_result_disposition || null,
            data.date_administered || null,
            data.applied_to_arm || null,
            data.reference_range_note || null,
            data.clinical_significance_note || null,
            data.result_interpretation_note || null,
            id
        ]);

        if (data.testReportQuestionList && data.testReportQuestionList.length > 0) {
            for (const q of data.testReportQuestionList) {
                const questionId = q.report_question_id || q.report_questions_id;
                if (!questionId) continue;

                const existing = await queryOne(`
                    SELECT id FROM lab_test_category_report_question_answer
                    WHERE lab_test_category_report_id = $1 AND report_questions_id = $2
                      AND deleted = false
                    LIMIT 1
                `, [id, questionId]);

                let stringVal = q.value;
                if (stringVal !== null && stringVal !== undefined) {
                    stringVal = stringVal.toString();
                } else {
                    stringVal = '';
                }

                if (existing) {
                    await queryOne(`
                        UPDATE lab_test_category_report_question_answer
                        SET value = $1
                        WHERE id = $2
                    `, [stringVal, existing.id]);
                } else {
                    await queryOne(`
                        INSERT INTO lab_test_category_report_question_answer (
                            lab_test_category_report_id, report_questions_id, value,
                            creation_timestamp, created_by_id, status, deleted
                        ) VALUES ($1, $2, $3, NOW(), $4, true, false)
                    `, [id, questionId, stringVal, req.user.id]);
                }
            }
        }

        if (data.testResultParameterList && data.testResultParameterList.length > 0) {
            for (const p of data.testResultParameterList) {
                const paramId = p.report_request_parameters_id || p.id;
                if (!paramId) continue;

                const existing = await queryOne(`
                    SELECT id FROM lab_test_category_report_request_parameter_value
                    WHERE lab_test_category_report_id = $1 AND report_request_parameters_id = $2
                      AND deleted = false
                    LIMIT 1
                `, [id, paramId]);

                let stringVal = p.value;
                if (stringVal !== null && stringVal !== undefined) {
                    stringVal = stringVal.toString();
                } else {
                    stringVal = '';
                }

                if (existing) {
                    await queryOne(`
                        UPDATE lab_test_category_report_request_parameter_value
                        SET value = $1
                        WHERE id = $2
                    `, [stringVal, existing.id]);
                } else {
                    await queryOne(`
                        INSERT INTO lab_test_category_report_request_parameter_value (
                            lab_test_category_report_id, report_request_parameters_id, value,
                            creation_timestamp, created_by_id, status, deleted
                        ) VALUES ($1, $2, $3, NOW(), $4, true, false)
                    `, [id, paramId, stringVal, req.user.id]);
                }
            }
        }

        return resp(res, '200', 'Report updated successfully');
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST changeLabTestCategoryReportStatus (Lock/Unlock)
router.post('/changeLabTestCategoryReportStatus', async (req, res) => {
    try {
        const { id, status } = req.body;
        // status boolean (true = locked, false = unlocked)
        await queryOne('UPDATE lab_test_category_report SET status = $1 WHERE id = $2', [status, id]);
        return resp(res, '200', 'Report lock status updated');
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST downloadLabTestCategoryReport — formatted PDF (no password on download)
router.post('/downloadLabTestCategoryReport', async (req, res) => {
    try {
        const { buildLabTestReportPdf } = require('../utils/labTestReportPdf');
        const { id } = req.body;
        if (!id) return res.status(400).json({ response_code: '400', obj: 'Report id is required' });

        const pdf = await buildLabTestReportPdf(id, { encrypt: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${pdf.filename}`);
        return res.send(pdf.buffer);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            const code = err.code === '404' ? 404 : 500;
            return res.status(code).json({ response_code: String(code), obj: err.message });
        }
    }
});

// POST emailLabTestCategoryReport — email PDF to patient (no password)
router.post('/emailLabTestCategoryReport', async (req, res) => {
    try {
        const { buildLabTestReportPdf } = require('../utils/labTestReportPdf');
        const { sendLabTestCategoryReportMail } = require('../utils/emailService');
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Report id is required');

        const pdf = await buildLabTestReportPdf(id, { encrypt: false });
        const to = (pdf.report.patient_email || '').trim();
        if (!to) return resp(res, '400', 'No email address found for this patient');

        const ok = await sendLabTestCategoryReportMail(
            to,
            pdf.report.patient_name,
            pdf.report.lab_test_name,
            pdf.report.uid,
            pdf.buffer,
            pdf.filename,
            pdf.b2b
        );

        if (!ok) return resp(res, '500', 'Failed to send email via SMTP');

        await queryOne(
            `UPDATE lab_test_category_report SET is_email_send = true WHERE id = $1`,
            [id]
        ).catch(() => null);

        return resp(res, '200', {
            message: 'Report emailed successfully',
            email: to,
        });
    } catch (err) {
        console.error(err);
        if (err.code === '404') return resp(res, '404', 'Report not found');
        return resp(res, '500', err.message);
    }
});

// POST getLabTestCategoryCountList
router.post('/getLabTestCategoryCountList', async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        // The user ID from the JWT payload
        const b2bUserId = req.user.id;

        let queryStr = `
            SELECT 
                l.id as lab_test_id,
                l.name,
                COUNT(r.id) as "labTestCount"
            FROM lab_tests l
            INNER JOIN lab_test_category_report r ON r.lab_test_id = l.id
            WHERE r.b2b_client_id = $1 AND r.deleted = false
        `;
        const values = [b2bUserId];
        let paramIndex = 2;

        if (startDate && endDate) {
            queryStr += ` AND DATE(r.creation_timestamp) BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            values.push(startDate, endDate);
        }

        queryStr += ` GROUP BY l.id, l.name ORDER BY l.name ASC`;

        const { rows } = await query(queryStr, values);

        return resp(res, '200', rows);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
