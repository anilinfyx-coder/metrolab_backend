const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');

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
        report.labTest = labTest;

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
            WHERE rq.lab_test_id = $2 AND rq.deleted = false
            ORDER BY rq.id ASC
        `;
        const { rows: questions } = await query(questionsQuery, [id, report.lab_test_id]);
        report.testReportQuestionList = questions;

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
            WHERE rp.lab_test_id = $2 AND rp.deleted = false
            ORDER BY rp.id ASC
        `;
        const { rows: parameters } = await query(parametersQuery, [id, report.lab_test_id]);
        report.testResultParameterList = parameters;

        const { rows: specimens } = await query(
            `SELECT st.*
             FROM lab_test_category_specimen_type_mapping m
             JOIN specimen_type st ON st.id = m.specimen_type_id
             WHERE m.lab_test_id = $1 AND m.deleted = false AND st.deleted = false
             ORDER BY st.name ASC`,
            [report.lab_test_id]
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
            data.fasting || null,
            data.requisition_no || null,
            data.device_identifier || null,
            data.date_administered || null,
            data.applied_to_arm || null,
            data.lot || null,
            data.expiry_date || null,
            data.date_read || null,
            data.mm_indurations || null,
            data.follow_up || null,
            data.reference_range_note || null,
            data.clinical_significance_note || null,
            data.result_interpretation_note || null,
            data.final_result_disposition || null,
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

        // 3. Save parameters
        if (data.testResultParameterList && data.testResultParameterList.length > 0) {
            for (const p of data.testResultParameterList) {
                const existing = await queryOne(`
                    SELECT id FROM lab_test_category_report_request_parameter_value 
                    WHERE lab_test_category_report_id = $1 AND report_request_parameters_id = $2
                `, [id, p.report_request_parameters_id]);

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
                            creation_timestamp, created_by_id
                        ) VALUES ($1, $2, $3, NOW(), $4)
                    `, [id, p.report_request_parameters_id, stringVal, req.user.id]);
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

// POST downloadLabTestCategoryReport — simple PDF download
router.post('/downloadLabTestCategoryReport', async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const { id } = req.body;

        const report = await queryOne(
            `SELECT r.*,
                    p.name as patient_name,
                    p.uid as patient_uid,
                    p.email as patient_email,
                    p.mobile as patient_mobile,
                    l.name as lab_test_name
             FROM lab_test_category_report r
             LEFT JOIN patient p ON p.id = r.patient_id
             LEFT JOIN lab_tests l ON l.id = r.lab_test_id
             WHERE r.id = $1
             LIMIT 1`,
            [id]
        );

        if (!report) {
            return res.status(404).json({ response_code: '404', obj: 'Report not found' });
        }

        const doc = new PDFDocument({ margin: 50 });
        const filename = `${report.uid || `Report-${report.id}`}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        doc.pipe(res);

        doc.fontSize(18).text('Lab Test Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`UID: ${report.uid || '—'}`);
        doc.text(`Test: ${report.lab_test_name || '—'}`);
        doc.text(`Patient/Donor: ${report.patient_name || '—'}`);
        doc.text(`Patient UID: ${report.patient_uid || '—'}`);
        doc.text(`Mobile: ${report.patient_mobile || '—'}`);
        doc.text(`Email: ${report.patient_email || '—'}`);
        doc.moveDown();
        doc.text(`Creation: ${report.creation_timestamp ? new Date(report.creation_timestamp).toLocaleString() : '—'}`);
        doc.text(`Reason for Test: ${report.reason_for_test || '—'}`);
        doc.text(`Final Result: ${report.final_result || '—'}`);
        doc.text(`Report Status: ${report.report_status || '—'}`);
        doc.text(`Collected: ${report.collected_timestamp ? new Date(report.collected_timestamp).toLocaleString() : '—'}`);
        doc.text(`Received: ${report.received_timestamp ? new Date(report.received_timestamp).toLocaleString() : '—'}`);
        doc.text(`Reported: ${report.reported_timestamp ? new Date(report.reported_timestamp).toLocaleString() : '—'}`);
        doc.end();
    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            return res.status(500).json({ response_code: '500', obj: err.message });
        }
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
