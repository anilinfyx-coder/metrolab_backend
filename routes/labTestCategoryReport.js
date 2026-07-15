const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

router.use(authMiddleware);

// GET all reports (replaces crudRoutes GET /)
router.get('/', async (req, res) => {
    try {
        let whereClause = "WHERE deleted = false";
        const values = [];
        let index = 1;
        
        const filterable = ['lab_test_id', 'drug_id', 'b2b_client_id', 'corporate_client_id', 'specimen_type_id'];
        for (const key of filterable) {
            if (req.query[key] !== undefined) {
                whereClause += ` AND ${key} = $${index++}`;
                values.push(req.query[key]);
            }
        }

        const { rows } = await query(`SELECT * FROM lab_test_category_report ${whereClause} ORDER BY id DESC`, values);
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
        
        // 1. Fetch the report itself
        const report = await queryOne(`
            SELECT r.*, l.name as lab_test_name 
            FROM lab_test_category_report r
            LEFT JOIN lab_tests l ON r.lab_test_id = l.id
            WHERE r.id = $1
        `, [id]);
        
        if (!report) {
            return res.status(404).json({ response_code: '404', obj: 'Report not found' });
        }

        // 2. Fetch the lab test UI flags so the frontend knows what to render
        const labTest = await queryOne(`SELECT * FROM lab_tests WHERE id = $1`, [report.lab_test_id]);
        report.labTest = labTest;

        // 3. Fetch questions and their answers for this report
        // Using LEFT JOIN so we get the question even if there's no answer yet
        const questionsQuery = `
            SELECT 
                rq.id as report_question_id,
                rq.question_text,
                rq.description,
                rq.answer_type,
                rq.answer_option,
                a.id as answer_id,
                a.answer as value
            FROM report_questions rq
            LEFT JOIN lab_test_category_report_question_answer a 
                ON a.report_question_id = rq.id AND a.lab_test_category_report_id = $1
            WHERE rq.lab_test_id = $2 AND rq.deleted = false
            ORDER BY rq.id ASC
        `;
        const { rows: questions } = await query(questionsQuery, [id, report.lab_test_id]);
        
        report.testReportQuestionList = questions;

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

        // 1. Update the main report fields
        await queryOne(`
            UPDATE lab_test_category_report 
            SET 
                specimen_type_id = $1,
                collected_timestamp = $2,
                received_timestamp = $3,
                reported_timestamp = $4,
                date_of_test = $5,
                test_performed_by = $6,
                reason_for_test = $7,
                final_result = $8,
                test_remark = $9,
                report_status = $10,
                final_remark = $11,
                test_result = $12
            WHERE id = $13
        `, [
            data.specimen_type_id || null,
            data.collected_timestamp || null,
            data.received_timestamp || null,
            data.reported_timestamp || null,
            data.date_of_test || null,
            data.test_performed_by || null,
            data.reason_for_test || null,
            data.final_result || null,
            data.test_remark || null,
            data.report_status || null,
            data.final_remark || null,
            data.test_result || null,
            id
        ]);

        // 2. Save questions
        if (data.testReportQuestionList && data.testReportQuestionList.length > 0) {
            for (const q of data.testReportQuestionList) {
                // Check if answer already exists
                const existing = await queryOne(`
                    SELECT id FROM lab_test_category_report_question_answer 
                    WHERE lab_test_category_report_id = $1 AND report_question_id = $2
                `, [id, q.report_question_id]);

                // Some boolean answers might be sent as boolean, cast to string
                let stringVal = q.value;
                if (stringVal !== null && stringVal !== undefined) {
                    stringVal = stringVal.toString();
                } else {
                    stringVal = '';
                }

                if (existing) {
                    await queryOne(`
                        UPDATE lab_test_category_report_question_answer 
                        SET answer = $1 
                        WHERE id = $2
                    `, [stringVal, existing.id]);
                } else {
                    await queryOne(`
                        INSERT INTO lab_test_category_report_question_answer (
                            lab_test_category_report_id, report_question_id, answer, 
                            creation_timestamp, created_by_id
                        ) VALUES ($1, $2, $3, NOW(), $4)
                    `, [id, q.report_question_id, stringVal, req.user.id]);
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

module.exports = router;
