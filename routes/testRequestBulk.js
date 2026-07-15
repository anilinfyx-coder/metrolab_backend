const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
    try {
        const { rows } = await query(`
            SELECT t.*, c.company_name as "corporateClientCompany", b.company_name as "b2bClientCompany"
            FROM test_request t
            LEFT JOIN corporate_clients c ON t.corporate_client_id = c.id
            LEFT JOIN b2b_clients b ON t.b2b_client_id = b.id
            WHERE t.deleted = false 
            ORDER BY t.id DESC
        `);
        
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
                corporateClientCompany: r.corporateClientCompany,
                b2bClientCompany: r.b2bClientCompany,
                creationTimestamp: `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}, ${date.getHours() > 12 ? date.getHours() - 12 : (date.getHours() === 0 ? 12 : date.getHours())}:${date.getMinutes().toString().padStart(2, '0')} ${date.getHours() >= 12 ? 'PM' : 'AM'}`
            };
        });

        return resp(res, '200', formatted);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

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

router.post('/changeTestRequestStatus', async (req, res) => {
    try {
        const { id, status } = req.body;
        // status boolean (true = Processed, false = Rejected)
        await queryOne('UPDATE test_request SET status = $1 WHERE id = $2', [status, id]);
        return resp(res, '200', 'Test Request Status Updated Successfully');
    } catch(err) {
        return resp(res, '500', err.message);
    }
});

const PDFDocument = require('pdfkit');

router.post('/downloadTestRequestReport', async (req, res) => {
    try {
        const { id } = req.body;
        // Fetch the test request details
        const trQuery = `
            SELECT t.*, c.company_name as "corporateClientCompany", b.company_name as "b2bClientCompany"
            FROM test_request t
            LEFT JOIN corporate_clients c ON t.corporate_client_id = c.id
            LEFT JOIN b2b_clients b ON t.b2b_client_id = b.id
            WHERE t.id = $1 AND t.deleted = false
        `;
        const tr = await queryOne(trQuery, [id]);

        if (!tr) {
            return res.status(404).json({ response_code: '404', obj: 'Test Request not found' });
        }

        // Fetch employees associated with this test request
        const { rows: employees } = await query(`
            SELECT e.first_name, e.last_name, e.department, tre.is_selected_for_drug, tre.is_selected_for_alcohol, tre.is_selected_for_alternate
            FROM test_request_employee tre
            JOIN employees e ON tre.employee_id = e.id
            WHERE tre.test_request_id = $1
        `, [id]);

        // Generate PDF
        const doc = new PDFDocument({ margin: 50 });
        
        // Set response headers to force download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=TR-${id}-Report.pdf`);
        
        doc.pipe(res);

        // Header
        doc.fontSize(20).text('Test Request Report', { align: 'center' });
        doc.moveDown();
        
        // Info Section
        doc.fontSize(12);
        doc.text(`Request ID: TR-${tr.id}`);
        doc.text(`Date: ${new Date(tr.creation_timestamp).toLocaleString()}`);
        doc.text(`Corporate Name: ${tr.corporateClientCompany || tr.b2bClientCompany || 'N/A'}`);
        doc.text(`Title: ${tr.title}`);
        doc.text(`Year: ${tr.year} | Quarter: ${tr.quarter}`);
        doc.text(`Status: ${tr.status === false ? 'Rejected' : (tr.status === true ? 'Processed' : 'Pending')}`);
        doc.moveDown();

        // Employees List
        doc.fontSize(16).text('Assigned Employees', { underline: true });
        doc.moveDown();

        if (employees.length === 0) {
            doc.fontSize(12).text('No employees found for this test request.', { font: 'Helvetica-Oblique' });
        } else {
            doc.fontSize(10);
            employees.forEach((emp, index) => {
                const tests = [];
                if (emp.is_selected_for_drug) tests.push('Drug');
                if (emp.is_selected_for_alcohol) tests.push('Alcohol');
                if (emp.is_selected_for_alternate) tests.push('Alternate');
                
                doc.text(`${index + 1}. ${emp.first_name} ${emp.last_name} (${emp.department || 'No Department'}) - Tests: ${tests.length > 0 ? tests.join(', ') : 'None'}`);
            });
        }

        // Finalize PDF
        doc.end();

    } catch(err) {
        console.error(err);
        return res.status(500).json({ response_code: '500', obj: err.message });
    }
});

module.exports = router;
