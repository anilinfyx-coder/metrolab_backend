const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });
const { authMiddleware } = require('../middleware/auth');
const { sendLabNotificationMail, sendTestRequestEmployeeReportMail } = require('../utils/emailService');

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
        
        // Format for listing UI: DD-MM-YYYY HH:MM:SS
        const formatted = rows.map(r => {
            const date = new Date(r.creation_timestamp);
            const pad = (n) => String(n).padStart(2, '0');
            const dateTime = Number.isNaN(date.getTime())
                ? ''
                : `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

            return {
                id: r.id,
                title: r.title,
                year: r.year,
                frequency: r.frequency,
                quarter: r.quarter,
                status: r.status,
                allSubmitStatus: r.all_submit_status ?? r.status,
                numberOfEmployee: r.total_count,
                corporateClientCompany: r.corporateClientCompany,
                b2bClientCompany: r.b2bClientCompany,
                creation_timestamp: r.creation_timestamp,
                creationTimestamp: dateTime,
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

        const isCorporate = req.user.portal === 'corporate';
        const corpClientId = isCorporate ? req.user.id : req.user.corporate_client_id;
        
        let b2bClientId = req.user.b2b_client_id;
        if (isCorporate) {
            const corp = await queryOne('SELECT b2b_client_id FROM corporate_clients WHERE id = $1', [corpClientId]);
            if (corp) b2bClientId = corp.b2b_client_id;
        }

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
            corpClientId || null,
            b2bClientId || null,
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
                    b2bClientId || null,
                    req.user.id || null
                ]);
            }
        }

        if (b2bClientId) {
            const b2bClient = await queryOne('SELECT email, company_name FROM b2b_clients WHERE id = $1', [b2bClientId]);
            const corpClient = corpClientId ? await queryOne('SELECT company_name FROM corporate_clients WHERE id = $1', [corpClientId]) : null;
            
            if (b2bClient && b2bClient.email) {
                const corpName = corpClient ? corpClient.company_name : 'N/A';
                sendLabNotificationMail(b2bClient.email, b2bClient.company_name, corpName, payload.title, payload.totalCount).catch(err => console.error('Lab Notification Email error:', err));
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
        const corpClientId = req.user.portal === 'corporate' ? req.user.id : req.user.corporate_client_id;
        const { rows } = await query(`
            SELECT id, creation_timestamp, title, year, frequency, quarter, total_count, status
            FROM test_request
            WHERE corporate_client_id = $1 AND deleted = false
            ORDER BY id DESC
        `, [corpClientId]);

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

function formatListDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// GET /api/TestRequest/:id — full details + employees for view page
router.get('/:id', async (req, res) => {
    try {
        const tr = await queryOne(`
            SELECT t.*,
                   c.company_name as corporate_client_company,
                   b.company_name as b2b_client_company
            FROM test_request t
            LEFT JOIN corporate_clients c ON t.corporate_client_id = c.id
            LEFT JOIN b2b_clients b ON t.b2b_client_id = b.id
            WHERE t.id = $1 AND t.deleted = false
            LIMIT 1
        `, [req.params.id]);

        if (!tr) return resp(res, '404', 'Test Request not found');

        const { rows: employees } = await query(`
            SELECT tre.id,
                   tre.employee_id,
                   tre.is_selected_for_drug,
                   tre.is_selected_for_alcohol,
                   tre.is_selected_for_alternate,
                   tre.status,
                   tre.deleted,
                   e.first_name,
                   e.last_name,
                   e.mobile,
                   e.department,
                   e.email
            FROM test_request_employee tre
            JOIN employees e ON e.id = tre.employee_id
            WHERE tre.test_request_id = $1
              AND tre.deleted = false
            ORDER BY e.last_name ASC NULLS LAST, e.first_name ASC NULLS LAST
        `, [tr.id]);

        const totalSelectedCount = employees.filter(
            (e) => e.is_selected_for_drug || e.is_selected_for_alcohol || e.is_selected_for_alternate
        ).length;

        return resp(res, '200', {
            id: tr.id,
            title: tr.title,
            reason_for_test: tr.reason_for_test,
            test_type: tr.test_type,
            year: tr.year,
            frequency: tr.frequency,
            quarter: tr.quarter,
            selection_type: tr.selection_type,
            drug_count: tr.drug_count,
            alcohol_count: tr.alcohol_count,
            alternate_count: tr.alternate_count,
            total_count: tr.total_count,
            total_selected_count: totalSelectedCount,
            status: tr.status,
            creation_timestamp: tr.creation_timestamp,
            creationTimestamp: formatListDateTime(tr.creation_timestamp),
            corporateClientCompany: tr.corporate_client_company,
            b2bClientCompany: tr.b2b_client_company,
            employees: employees.map((e) => ({
                id: e.id,
                employee_id: e.employee_id,
                first_name: e.first_name || '',
                last_name: e.last_name || '',
                mobile: e.mobile || '',
                department: e.department || '',
                email: e.email || '',
                is_selected_for_drug: !!e.is_selected_for_drug,
                is_selected_for_alcohol: !!e.is_selected_for_alcohol,
                is_selected_for_alternate: !!e.is_selected_for_alternate,
                status: e.status !== false,
            })),
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST exclude / restore employee on a test request
router.post('/changeTestRequestEmployeeStatus', async (req, res) => {
    try {
        const { id, status } = req.body;
        if (!id) return resp(res, '400', 'Employee row id is required');
        await queryOne(
            `UPDATE test_request_employee SET status = $1 WHERE id = $2`,
            [!!status, id]
        );
        return resp(res, '200', 'Employee status updated');
    } catch (err) {
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

router.post('/getTestRequestEmployees', async (req, res) => {
    try {
        const { test_request_id } = req.body;
        if (!test_request_id) return resp(res, '400', 'Missing test_request_id');

        // Fetch employees associated with this test request
        const { rows: employees } = await query(`
            SELECT e.id, e.first_name, e.last_name, e.mobile, e.department, 
                   tre.is_selected_for_drug, tre.is_selected_for_alcohol, tre.is_selected_for_alternate,
                   tre.drug_report_submit_status as "drugReportSubmitStatus", 
                   tre.alcohol_report_submit_status as "alcoholReportSubmitStatus"
            FROM test_request_employee tre
            JOIN employees e ON tre.employee_id = e.id
            WHERE tre.test_request_id = $1
        `, [test_request_id]);

        return resp(res, '200', employees);
    } catch(err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

router.post('/emailTestRequestReport', async (req, res) => {
    try {
        const { test_request_id, employee_id } = req.body;
        
        const trQuery = `
            SELECT t.*, c.company_name as "corporateClientCompany", b.company_name as "b2bClientCompany"
            FROM test_request t
            LEFT JOIN corporate_clients c ON t.corporate_client_id = c.id
            LEFT JOIN b2b_clients b ON t.b2b_client_id = b.id
            WHERE t.id = $1 AND t.deleted = false
        `;
        const tr = await queryOne(trQuery, [test_request_id]);
        if (!tr) return resp(res, '404', 'Test Request not found');

        const { rows: employees } = await query(`
            SELECT e.first_name, e.last_name, e.department, e.email, tre.is_selected_for_drug, tre.is_selected_for_alcohol, tre.is_selected_for_alternate
            FROM test_request_employee tre
            JOIN employees e ON tre.employee_id = e.id
            WHERE tre.test_request_id = $1 AND e.id = $2
        `, [test_request_id, employee_id]);
        
        const emp = employees[0];
        if (!emp) return resp(res, '404', 'Employee not found in this request');
        if (!emp.email) return resp(res, '400', 'Employee does not have an email address');

        // Generate PDF into a Buffer
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfData = Buffer.concat(buffers);
            const success = await sendTestRequestEmployeeReportMail(
                emp.email,
                `${emp.first_name} ${emp.last_name}`,
                tr.title,
                pdfData,
                `TR-${tr.id}-${emp.first_name}-Report.pdf`
            );
            if (success) {
                return resp(res, '200', 'Email sent successfully');
            } else {
                return resp(res, '500', 'Failed to send email via SMTP');
            }
        });

        // Header
        doc.fontSize(20).text('Test Request Report (Employee)', { align: 'center' });
        doc.moveDown();
        
        // Info Section
        doc.fontSize(12);
        doc.text(`Request ID: TR-${tr.id}`);
        doc.text(`Date: ${new Date(tr.creation_timestamp).toLocaleString()}`);
        doc.text(`Corporate Name: ${tr.corporateClientCompany || tr.b2bClientCompany || 'N/A'}`);
        doc.text(`Title: ${tr.title}`);
        doc.moveDown();

        doc.fontSize(16).text('Employee Details', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`Name: ${emp.first_name} ${emp.last_name}`);
        doc.text(`Department: ${emp.department || 'N/A'}`);
        
        const tests = [];
        if (emp.is_selected_for_drug) tests.push('Drug');
        if (emp.is_selected_for_alcohol) tests.push('Alcohol');
        if (emp.is_selected_for_alternate) tests.push('Alternate');
        
        doc.text(`Assigned Tests: ${tests.length > 0 ? tests.join(', ') : 'None'}`);
        doc.end();

    } catch(err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
