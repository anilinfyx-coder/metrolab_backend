const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// POST /api/LabTestReport
router.post('/', async (req, res) => {
    try {
        const {
            waiting_list_id, lab_test_id, b2b_client_id,
            collectedDate, collectedTime, receivedDate, receivedTime,
            reportedDate, reportedTime, regulation, specimenTypeId,
            dateOfTest, dateOfTime, testPerformedBy, reportStatus,
            fasting, requisitionNo, deviceIdentifier, lot, expiryDate,
            dateRead, mmIndurations, followUp, finalResult, finalResultText,
            testRemark, referenceRangeNote, clinicalSignificanceNote,
            resultInterpretationNote, finalResultDisposition, finalRemark,
            dateAdministered, appliedToArm,
            questions, parameters
        } = req.body;

        // Get patient_id from waiting_list
        const wl = await queryOne(`SELECT patient_id FROM waiting_list WHERE id = $1`, [waiting_list_id]);
        if (!wl) return resp(res, '404', 'Waiting list not found');

        // ==== WALLET DEDUCTION LOGIC ====
        let testPrice = 0;
        let b2bClient = null;
        let newBalance = 0;
        if (b2b_client_id) {
            const labTest = await queryOne('SELECT name FROM lab_tests WHERE id = $1', [lab_test_id]);
            const testName = (labTest?.name || '').toLowerCase();
            
            let priceKey = 'alternate_test_price';
            if (testName.includes('drug')) priceKey = 'drug_test_price';
            else if (testName.includes('alcohol')) priceKey = 'alcohol_test_price';

            const priceRow = await queryOne('SELECT setting_value FROM global_settings WHERE setting_key = $1', [priceKey]);
            testPrice = parseFloat(priceRow?.setting_value || 0);

            if (testPrice > 0) {
                b2bClient = await queryOne('SELECT wallet_balance FROM b2b_clients WHERE id = $1', [b2b_client_id]);
                const currentBalance = parseFloat(b2bClient?.wallet_balance || 0);

                if (currentBalance < testPrice) {
                    return resp(res, '400', `Insufficient Wallet Balance. Needed: $${testPrice}, Available: $${currentBalance}`);
                }
                newBalance = currentBalance - testPrice;
            }
        }
        // ================================

        // Combine date/time fields if they exist
        const formatDateTime = (d, t) => (d && t ? `${d} ${t}` : null);
        const colTimestamp = formatDateTime(collectedDate, collectedTime);
        const recTimestamp = formatDateTime(receivedDate, receivedTime);
        const repTimestamp = formatDateTime(reportedDate, reportedTime);

        // Determine final result text (handle "Other")
        const fResult = finalResult === '' ? finalResultText : finalResult;

        // Generate report UID (LTCR0001, LTCR0002, ...)
        const lastUidRow = await queryOne(
            `SELECT uid FROM lab_test_category_report
             WHERE uid ~ '^LTCR[0-9]+$'
             ORDER BY CAST(SUBSTRING(uid FROM 5) AS INTEGER) DESC
             LIMIT 1`
        );
        let nextNum = 1;
        if (lastUidRow?.uid) {
            const parsed = parseInt(String(lastUidRow.uid).slice(4), 10);
            if (!Number.isNaN(parsed)) nextNum = parsed + 1;
        }
        const reportUid = `LTCR${String(nextNum).padStart(4, '0')}`;

        // Insert into lab_test_category_report
        const report = await queryOne(
            `INSERT INTO lab_test_category_report (
                uid, patient_id, lab_test_id, waiting_list_id,
                collected_timestamp, received_timestamp, reported_timestamp,
                regulation, specimen_type_id, date_of_test,
                test_performed_by, report_status, fasting, requisition_no,
                device_identifier, lot, expiry_date, date_read, mm_indurations,
                follow_up, final_result, test_remark, reference_range_note,
                clinical_significance_note, result_interpretation_note,
                final_result_disposition, final_remark, date_administered,
                applied_to_arm, status, deleted, creation_timestamp
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $10,
                $11, $12, $13, $14,
                $15, $16, $17, $18, $19,
                $20, $21, $22, $23,
                $24, $25,
                $26, $27, $28,
                $29, false, false, NOW()
            ) RETURNING *`,
            [
                reportUid, wl.patient_id, lab_test_id, waiting_list_id,
                colTimestamp, recTimestamp, repTimestamp,
                regulation, specimenTypeId || null, dateOfTest || null,
                testPerformedBy, reportStatus, fasting, requisitionNo,
                deviceIdentifier, lot, expiryDate || null, dateRead || null, mmIndurations,
                followUp, fResult, testRemark, referenceRangeNote,
                clinicalSignificanceNote, resultInterpretationNote,
                finalResultDisposition, finalRemark, dateAdministered || null,
                appliedToArm
            ]
        );

        // Insert questions
        if (questions && questions.length > 0) {
            for (const q of questions) {
                if (q.value) {
                    await queryOne(
                        `INSERT INTO lab_test_category_report_question_answer (
                            lab_test_category_report_id, report_questions_id, value,
                            status, deleted, creation_timestamp
                        ) VALUES ($1, $2, $3, true, false, NOW())`,
                        [report.id, q.id, q.value.toString()]
                    );
                }
            }
        }

        // Insert parameters
        if (parameters && parameters.length > 0) {
            for (const p of parameters) {
                if (p.value) {
                    await queryOne(
                        `INSERT INTO lab_test_category_report_request_parameter_value (
                            lab_test_category_report_id, report_request_parameters_id, value,
                            status, deleted, creation_timestamp
                        ) VALUES ($1, $2, $3, true, false, NOW())`,
                        [report.id, p.id, p.value.toString()]
                    );
                }
            }
        }

        // ==== COMPLETE WALLET TRANSACTION ====
        if (b2b_client_id && testPrice > 0) {
            await query('UPDATE b2b_clients SET wallet_balance = $1 WHERE id = $2', [newBalance, b2b_client_id]);
            await query(`
                INSERT INTO b2b_wallet_transactions (b2b_client_id, transaction_type, amount, closing_balance, description, reference_id)
                VALUES ($1, 'DEBIT', $2, $3, $4, $5)
            `, [b2b_client_id, testPrice, newBalance, 'Test Report Deduction', report.id]);
        }
        // =====================================

        return resp(res, '200', report);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
