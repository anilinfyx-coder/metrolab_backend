const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.post('/saveTestRequestInBulk', async (req, res) => {
    try {
        const payload = req.body;
        // payload expects:
        // title, year, frequency, quarter, testType, selectionType
        // reasonForTest, drugCount, alcoholCount, alternateCount, totalCount
        // employeesList: [{ id, isSelectedForDrug, isSelectedForAlcohol, isSelectedForAlternate }]

        // 1. Insert parent test_request record
        const trQuery = `
            INSERT INTO test_request (
                title, year, frequency, quarter, test_type, selection_type,
                drug_count, alcohol_count, alternate_count, total_count, reason_for_test,
                corporate_client_id, b2b_client_id, created_by_id, creation_timestamp
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
            ) RETURNING id
        `;
        const trValues = [
            payload.title || '',
            payload.year || '2025',
            payload.frequency || '',
            payload.quarter || '',
            payload.testType || '',
            payload.selectionType || '1',
            payload.drugCount || 0,
            payload.alcoholCount || 0,
            payload.alternateCount || 0,
            payload.totalCount || 0,
            payload.reasonForTest || '',
            req.user.corporate_client_id || null,
            req.user.b2b_client_id || null,
            req.user.id || null
        ];

        const tr = await queryOne(trQuery, trValues);

        if (!tr) {
            return resp(res, '500', 'Failed to create Test Request');
        }

        // 2. Insert into test_request_employee for each employee
        if (payload.employeesList && payload.employeesList.length > 0) {
            for (const emp of payload.employeesList) {
                // If they are not selected for any, we still record them as part of the total pool for this request (like old app)
                await queryOne(`
                    INSERT INTO test_request_employee (
                        test_request_id, employee_id,
                        is_selected_for_drug, is_selected_for_alcohol, is_selected_for_alternate,
                        b2b_client_id, created_by_id, creation_timestamp
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                `, [
                    tr.id,
                    emp.id,
                    !!emp.isSelectedForDrug,
                    !!emp.isSelectedForAlcohol,
                    !!emp.isSelectedForAlternate,
                    req.user.b2b_client_id || null,
                    req.user.id || null
                ]);
            }
        }

        return resp(res, '200', 'Test Request Generated Successfully');
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET list of test requests for this corporate client
router.post('/getTestRequestList', async (req, res) => {
    try {
        const { rows } = await query(`
            SELECT id, creation_timestamp, title, year, frequency, quarter, total_count, status
            FROM test_request
            WHERE corporate_client_id = $1 AND deleted = false
            ORDER BY id DESC
        `, [req.user.corporate_client_id]);

        // Format creation_timestamp like legacy UI: MM/DD/YYYY, HH:mm A
        const formatted = rows.map(r => {
            const date = new Date(r.creation_timestamp);
            return {
                id: r.id,
                title: r.title,
                year: r.year,
                frequency: r.frequency,
                quarter: r.quarter,
                status: r.status,
                allSubmitStatus: r.status,
                numberOfEmployee: r.total_count,
                creationTimestamp: `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}, ${date.getHours() > 12 ? date.getHours() - 12 : (date.getHours() === 0 ? 12 : date.getHours())}:${date.getMinutes().toString().padStart(2, '0')} ${date.getHours() >= 12 ? 'PM' : 'AM'}`
            };
        });

        return resp(res, '200', formatted);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// Delete
router.post('/deleteTestRequest', async (req, res) => {
    try {
        await queryOne('UPDATE test_request SET deleted = true, deleted_timestamp = NOW() WHERE id = $1', [req.body.id]);
        return resp(res, '200', 'Test Request Deleted Successfully');
    } catch(err) {
        return resp(res, '500', err.message);
    }
});

module.exports = router;
