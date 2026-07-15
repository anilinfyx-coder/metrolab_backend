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

        // Combine date/time fields if they exist
        const formatDateTime = (d, t) => (d && t ? `${d} ${t}` : null);
        const colTimestamp = formatDateTime(collectedDate, collectedTime);
        const recTimestamp = formatDateTime(receivedDate, receivedTime);
        const repTimestamp = formatDateTime(reportedDate, reportedTime);

        // Determine final result text (handle "Other")
        const fResult = finalResult === '' ? finalResultText : finalResult;

        // Insert into lab_test_category_report
        const report = await queryOne(
            `INSERT INTO lab_test_category_report (
                patient_id, lab_test_id, waiting_list_id,
                collected_timestamp, received_timestamp, reported_timestamp,
                regulation, specimen_type_id, date_of_test,
                test_performed_by, report_status, fasting, requisition_no,
                device_identifier, lot, expiry_date, date_read, mm_indurations,
                follow_up, final_result, test_remark, reference_range_note,
                clinical_significance_note, result_interpretation_note,
                final_result_disposition, final_remark, date_administered,
                applied_to_arm, status, deleted, creation_timestamp
            ) VALUES (
                $1, $2, $3,
                $4, $5, $6,
                $7, $8, $9,
                $10, $11, $12, $13,
                $14, $15, $16, $17, $18,
                $19, $20, $21, $22,
                $23, $24,
                $25, $26, $27,
                $28, true, false, NOW()
            ) RETURNING *`,
            [
                wl.patient_id, lab_test_id, waiting_list_id,
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

        return resp(res, '200', report);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

module.exports = router;
