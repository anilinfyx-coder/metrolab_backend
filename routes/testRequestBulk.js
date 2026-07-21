const express = require('express');
const router = express.Router();
const { pool, query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });
const { authMiddleware } = require('../middleware/auth');
const { resolveAdminContext } = require('../utils/adminContext');
const { sendLabNotificationMail, sendTestRequestEmployeeReportMail } = require('../utils/emailService');

router.use(authMiddleware);

router.get('/', async (req, res) => {
    try {
        let whereClause = "t.deleted = false";
        const values = [];
        if (req.query.corporate_client_id) {
            values.push(req.query.corporate_client_id);
            whereClause += ` AND t.corporate_client_id = $${values.length}`;
        }
        if (req.query.b2b_client_id) {
            values.push(req.query.b2b_client_id);
            whereClause += ` AND t.b2b_client_id = $${values.length}`;
        }

        const { rows } = await query(`
            SELECT t.*, c.company_name as "corporateClientCompany", b.company_name as "b2bClientCompany"
            FROM test_request t
            LEFT JOIN corporate_clients c ON t.corporate_client_id = c.id
            LEFT JOIN b2b_clients b ON t.b2b_client_id = b.id
            WHERE ${whereClause}
            ORDER BY t.id DESC
        `, values);
        
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

function transferRequisitionNo(testRequestId, employeeId) {
    return `TR-${testRequestId}-E-${employeeId}`;
}

async function generateNextPatientUid(client) {
    const run = (text, params) => client.query(text, params);
    const { rows } = await run(
        `SELECT uid FROM patient
         WHERE uid ~ '^PT[0-9]+$'
         ORDER BY CAST(SUBSTRING(uid FROM 3) AS INTEGER) DESC
         LIMIT 1
         FOR UPDATE`
    );

    let nextNum = 1;
    if (rows[0]?.uid) {
        const parsed = parseInt(rows[0].uid.slice(2), 10);
        if (!Number.isNaN(parsed)) nextNum = parsed + 1;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
        const uid = `PT${String(nextNum + attempt).padStart(3, '0')}`;
        const exists = await run(`SELECT id FROM patient WHERE uid = $1 LIMIT 1`, [uid]);
        if (exists.rows.length === 0) return uid;
    }

    throw new Error('Unable to generate a unique patient UID');
}

async function resolveAdminContextForRequest(userId) {
    return resolveAdminContext(userId);
}

async function resolveLabTestIdsForEmployee(b2bClientId, selections) {
    const { rows: accessible } = await query(
        `SELECT lt.id, lt.name
         FROM b2b_client_lab_test_access a
         JOIN lab_tests lt ON lt.id = a.lab_test_id
         WHERE a.b2b_client_id = $1
           AND a.deleted = false
           AND a.status IS DISTINCT FROM false
           AND lt.deleted = false
           AND lt.status IS DISTINCT FROM false
         ORDER BY lt.id ASC`,
        [b2bClientId]
    );

    if (accessible.length === 0) return [];

    const findByKeyword = (keyword) =>
        accessible.find((t) => t.name.toLowerCase().includes(keyword))?.id;

    const ids = [];
    if (selections.drug) {
        const drugId = findByKeyword('drug');
        if (drugId) ids.push(drugId);
    }
    if (selections.alcohol) {
        const alcoholId = findByKeyword('alcohol');
        if (alcoholId) ids.push(alcoholId);
    }
    if (selections.alternate) {
        const alternateId = accessible.find(
            (t) =>
                !t.name.toLowerCase().includes('drug') &&
                !t.name.toLowerCase().includes('alcohol')
        )?.id;
        if (alternateId) ids.push(alternateId);
    }

    return [...new Set(ids)];
}

async function ensureCancellationReasonColumn(client) {
    const run = client ? client.query.bind(client) : query;
    const { rows } = await run(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'test_request_employee' AND column_name = 'cancellation_reason'
         LIMIT 1`
    );
    if (rows.length === 0) {
        await run(`ALTER TABLE test_request_employee ADD COLUMN cancellation_reason VARCHAR(255)`);
    }
}

async function loadTestRequestEmployeeRow(client, rowId) {
    const run = client ? client.query.bind(client) : query;
    const res = await run(
        `SELECT tre.*,
                tr.corporate_client_id,
                tr.b2b_client_id AS test_request_b2b_client_id
         FROM test_request_employee tre
         JOIN test_request tr ON tr.id = tre.test_request_id AND tr.deleted = false
         WHERE tre.id = $1 AND tre.deleted = false
         LIMIT 1`,
        [rowId]
    );
    return res.rows[0] || null;
}

async function findAlternateEmployees(current) {
    const colRes = await query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'employees'
           AND column_name IN ('corporate_client_id', 'company_uid')`
    );
    const hasCorporateClientId = colRes.rows.some((r) => r.column_name === 'corporate_client_id');
    const hasCompanyUid = colRes.rows.some((r) => r.column_name === 'company_uid');

    let companyUid = null;
    if (hasCompanyUid && current.corporate_client_id) {
        const corp = await queryOne(
            `SELECT uid FROM corporate_clients WHERE id = $1 LIMIT 1`,
            [current.corporate_client_id]
        );
        companyUid = corp?.uid || null;
    }

    const whereParts = [
        'e.deleted = false',
        '(e.status IS DISTINCT FROM false)',
        'e.id <> $1',
        `(
            NOT EXISTS (
                SELECT 1
                FROM test_request_employee tre2
                WHERE tre2.test_request_id = $2
                  AND tre2.employee_id = e.id
                  AND tre2.deleted = false
            )
            OR EXISTS (
                SELECT 1
                FROM test_request_employee tre3
                WHERE tre3.test_request_id = $2
                  AND tre3.employee_id = e.id
                  AND tre3.deleted = false
                  AND tre3.status IS DISTINCT FROM false
                  AND COALESCE(tre3.is_selected_for_drug, false) = false
                  AND COALESCE(tre3.is_selected_for_alcohol, false) = false
                  AND COALESCE(tre3.is_selected_for_alternate, false) = false
                  AND NOT EXISTS (
                      SELECT 1
                      FROM waiting_list wl
                      WHERE wl.employee_id = e.id
                        AND wl.requisition_no = CONCAT('TR-', tre3.test_request_id, '-E-', e.id)
                        AND wl.deleted = false
                  )
            )
        )`,
    ];
    const values = [current.employee_id, current.test_request_id];
    let nextParam = 3;

    if (hasCorporateClientId && current.corporate_client_id) {
        whereParts.push(`e.corporate_client_id = $${nextParam++}`);
        values.push(current.corporate_client_id);
    } else if (hasCompanyUid && companyUid) {
        whereParts.push(`e.company_uid = $${nextParam++}`);
        values.push(companyUid);
    }

    const { rows } = await query(
        `SELECT e.id,
                e.first_name,
                e.last_name,
                e.mobile,
                e.department
         FROM employees e
         WHERE ${whereParts.join(' AND ')}
         ORDER BY e.last_name ASC NULLS LAST, e.first_name ASC NULLS LAST`,
        values
    );
    return rows;
}

function mapEmployeeRow(e) {
    const hasSelectedTest =
        !!e.is_selected_for_drug || !!e.is_selected_for_alcohol || !!e.is_selected_for_alternate;
    const transferred = !!e.waiting_list_id;
    const isCancelled = e.status === false && hasSelectedTest && !transferred;

    return {
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
        waiting_list_id: e.waiting_list_id || null,
        transferred_to_waiting_list: transferred,
        is_cancelled: isCancelled,
        cancellation_reason: e.cancellation_reason || '',
    };
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

        await ensureCancellationReasonColumn();

        const { rows: employees } = await query(`
            SELECT tre.id,
                   tre.employee_id,
                   tre.is_selected_for_drug,
                   tre.is_selected_for_alcohol,
                   tre.is_selected_for_alternate,
                   tre.status,
                   tre.deleted,
                   tre.cancellation_reason,
                   e.first_name,
                   e.last_name,
                   e.mobile,
                   e.department,
                   e.email,
                   wl.id AS waiting_list_id
            FROM test_request_employee tre
            JOIN employees e ON e.id = tre.employee_id
            LEFT JOIN waiting_list wl ON wl.employee_id = tre.employee_id
                AND wl.requisition_no = CONCAT('TR-', tre.test_request_id, '-E-', tre.employee_id)
                AND wl.deleted = false
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
            employees: employees.map(mapEmployeeRow),
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

// POST list alternate employees for cancellation / reassignment modal
router.post('/getAlternateEmployeesForReassign', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Employee row id is required');

        const current = await loadTestRequestEmployeeRow(null, id);
        if (!current) return resp(res, '404', 'Employee not found on this test request');
        if (current.status === false) {
            return resp(res, '400', 'Employee is already cancelled');
        }

        const isSelected =
            current.is_selected_for_drug ||
            current.is_selected_for_alcohol ||
            current.is_selected_for_alternate;
        if (!isSelected) {
            return resp(res, '400', 'Employee is not allotted for any test');
        }

        const alternates = await findAlternateEmployees(current);
        return resp(res, '200', alternates.map((e) => ({
            id: e.id,
            first_name: e.first_name || '',
            last_name: e.last_name || '',
            mobile: e.mobile || '',
            department: e.department || '',
            label: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        })));
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// POST cancel current employee and assign selected alternate employee
router.post('/excludeAndReassignEmployee', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id, alternate_employee_id, reason } = req.body;
        if (!id) return resp(res, '400', 'Employee row id is required');
        if (!alternate_employee_id) return resp(res, '400', 'Alternate employee is required');
        if (!reason) return resp(res, '400', 'Reason is required');

        await ensureCancellationReasonColumn(client);

        const current = await loadTestRequestEmployeeRow(client, id);
        if (!current) return resp(res, '404', 'Employee not found on this test request');
        if (current.status === false) {
            return resp(res, '400', 'Employee is already cancelled');
        }

        const isSelected =
            current.is_selected_for_drug ||
            current.is_selected_for_alcohol ||
            current.is_selected_for_alternate;
        if (!isSelected) {
            return resp(res, '400', 'Employee is not allotted for any test');
        }

        const alternates = await findAlternateEmployees(current);
        const replacement = alternates.find((e) => e.id === Number(alternate_employee_id));
        if (!replacement) {
            return resp(res, '400', 'No employee available in this corporate to assign');
        }

        await client.query('BEGIN');

        await client.query(
            `UPDATE test_request_employee
             SET status = false,
                 cancellation_reason = $2
             WHERE id = $1`,
            [current.id, reason]
        );

        const existingAlternateRes = await client.query(
            `SELECT id
             FROM test_request_employee
             WHERE test_request_id = $1
               AND employee_id = $2
               AND deleted = false
             LIMIT 1`,
            [current.test_request_id, replacement.id]
        );
        const existingAlternate = existingAlternateRes.rows[0];

        let newRowId;
        if (existingAlternate) {
            const updated = await client.query(
                `UPDATE test_request_employee
                 SET is_selected_for_drug = $2,
                     is_selected_for_alcohol = $3,
                     is_selected_for_alternate = $4,
                     status = true,
                     cancellation_reason = NULL
                 WHERE id = $1
                 RETURNING id, employee_id`,
                [
                    existingAlternate.id,
                    !!current.is_selected_for_drug,
                    !!current.is_selected_for_alcohol,
                    !!current.is_selected_for_alternate,
                ]
            );
            newRowId = updated.rows[0];
        } else {
            const inserted = await client.query(
                `INSERT INTO test_request_employee (
                    test_request_id, employee_id,
                    is_selected_for_drug, is_selected_for_alcohol, is_selected_for_alternate,
                    b2b_client_id, created_by_id, user_id, role_type_id,
                    status, deleted, creation_timestamp
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,NOW())
                RETURNING id, employee_id`,
                [
                    current.test_request_id,
                    replacement.id,
                    !!current.is_selected_for_drug,
                    !!current.is_selected_for_alcohol,
                    !!current.is_selected_for_alternate,
                    current.test_request_b2b_client_id || current.b2b_client_id || null,
                    req.user.id || current.created_by_id || null,
                    current.user_id || null,
                    current.role_type_id || null,
                ]
            );
            newRowId = inserted.rows[0];
        }

        await client.query('COMMIT');

        return resp(res, '200', {
            message: 'Employee cancelled and reassigned successfully',
            old_row_id: current.id,
            new_row_id: newRowId.id,
            new_employee_id: newRowId.employee_id,
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
        console.error(err);
        return resp(res, '500', err.message);
    } finally {
        client.release();
    }
});

// POST transfer employee from test request to waiting list
router.post('/transferEmployeeToWaitingList', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.body;
        if (!id) return resp(res, '400', 'Employee row id is required');

        const row = await queryOne(
            `SELECT tre.*,
                    tr.id AS test_request_id,
                    tr.reason_for_test,
                    tr.corporate_client_id,
                    tr.b2b_client_id AS test_request_b2b_client_id,
                    tr.status AS test_request_status,
                    e.first_name,
                    e.last_name,
                    e.mobile,
                    e.email,
                    e.gender,
                    e.dob,
                    e.street1,
                    e.street2,
                    e.city,
                    e.state,
                    e.zipcode,
                    e.driving_license,
                    e.driving_license_state,
                    e.ssn
             FROM test_request_employee tre
             JOIN test_request tr ON tr.id = tre.test_request_id AND tr.deleted = false
             JOIN employees e ON e.id = tre.employee_id AND e.deleted = false
             WHERE tre.id = $1 AND tre.deleted = false
             LIMIT 1`,
            [id]
        );

        if (!row) return resp(res, '404', 'Employee not found on this test request');
        if (row.status === false) return resp(res, '400', 'Excluded employees cannot be transferred');
        if (row.test_request_status === false) return resp(res, '400', 'Rejected test requests cannot transfer employees');

        const isSelected =
            row.is_selected_for_drug ||
            row.is_selected_for_alcohol ||
            row.is_selected_for_alternate;
        if (!isSelected) {
            return resp(res, '400', 'Employee is not selected for any test');
        }

        const requisitionNo = transferRequisitionNo(row.test_request_id, row.employee_id);
        const existingWl = await queryOne(
            `SELECT id FROM waiting_list
             WHERE employee_id = $1 AND requisition_no = $2 AND deleted = false
             LIMIT 1`,
            [row.employee_id, requisitionNo]
        );
        if (existingWl) {
            return resp(res, '400', 'Employee has already been transferred to the waiting list');
        }

        const b2bClientId = row.test_request_b2b_client_id || row.b2b_client_id;
        if (!b2bClientId) return resp(res, '400', 'B2B client is not set for this test request');

        const labTestIds = await resolveLabTestIdsForEmployee(b2bClientId, {
            drug: !!row.is_selected_for_drug,
            alcohol: !!row.is_selected_for_alcohol,
            alternate: !!row.is_selected_for_alternate,
        });
        if (labTestIds.length === 0) {
            return resp(res, '400', 'No matching lab tests are configured for this B2B client');
        }

        const ctx = await resolveAdminContext(req.user.id);
        const patientName = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown';

        await client.query('BEGIN');

        let patient = null;
        if (row.mobile) {
            const found = await client.query(
                `SELECT * FROM patient
                 WHERE deleted = false AND b2b_client_id = $1 AND mobile = $2
                 ORDER BY id DESC LIMIT 1`,
                [b2bClientId, row.mobile]
            );
            patient = found.rows[0] || null;
        }

        if (!patient) {
            const patientUid = await generateNextPatientUid(client);
            const inserted = await client.query(
                `INSERT INTO patient
                    (b2b_client_id, uid, name, driving_license, mobile, email, gender, dob,
                     street1, street2, city, state, zipcode, driving_license_state, ssn,
                     created_by_id, user_id, role_type_id, status, deleted, creation_timestamp)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true,false,NOW())
                 RETURNING *`,
                [
                    b2bClientId,
                    patientUid,
                    patientName,
                    row.driving_license,
                    row.mobile,
                    row.email,
                    row.gender,
                    row.dob,
                    row.street1,
                    row.street2,
                    row.city,
                    row.state,
                    row.zipcode,
                    row.driving_license_state,
                    row.ssn,
                    ctx.created_by_id,
                    ctx.user_id,
                    ctx.role_type_id,
                ]
            );
            patient = inserted.rows[0];
        }

        const wlInsert = await client.query(
            `INSERT INTO waiting_list
                (patient_id, b2b_client_id, uid, reason_for_test, requisition_no,
                 corporate_client_id, employee_id, created_by_id, user_id, role_type_id,
                 status, deleted, creation_timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,false,NOW())
             RETURNING *`,
            [
                patient.id,
                b2bClientId,
                patient.uid,
                row.reason_for_test,
                requisitionNo,
                row.corporate_client_id,
                row.employee_id,
                ctx.created_by_id,
                ctx.user_id,
                ctx.role_type_id,
            ]
        );
        const waitingList = wlInsert.rows[0];

        for (const labTestId of labTestIds) {
            await client.query(
                `INSERT INTO waiting_test_lab_test
                    (waiting_list_id, lab_test_id, b2b_client_id, status, deleted, creation_timestamp)
                 VALUES ($1,$2,$3,true,false,NOW())`,
                [waitingList.id, labTestId, b2bClientId]
            );
        }

        await client.query('COMMIT');

        return resp(res, '200', {
            waiting_list_id: waitingList.id,
            patient_id: patient.id,
            patient_uid: patient.uid,
            message: 'Employee transferred to waiting list successfully',
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* no active transaction */ }
        console.error(err);
        return resp(res, '500', err.message);
    } finally {
        client.release();
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
