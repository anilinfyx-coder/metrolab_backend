const { queryOne } = require('../db');
const { normalizeOwnerB2bClientId } = require('./adminContext');

const DISPLAY_OPTION_FIELDS = [
    'show_collected_date',
    'show_collected_time',
    'show_received_date',
    'show_received_time',
    'show_reported_date',
    'show_reported_time',
    'show_report_status',
    'show_regulation',
    'show_specimen',
    'show_final_result',
    'show_requisition_no',
    'show_test_remark',
    'show_reason_for_test',
    'show_final_result_disposition',
    'show_final_remark',
    'show_date_administered',
    'show_test_date',
    'show_test_time',
    'show_test_performed_by',
    'show_fasting',
    'show_device_identifier',
    'show_applied_to',
    'show_lot',
    'show_expire_date',
    'show_date_read',
    'show_mm_indurations',
    'show_follow_up',
];

function pickDisplayOptions(source = {}) {
    const out = {};
    for (const field of DISPLAY_OPTION_FIELDS) {
        out[field] = !!source[field];
    }
    return out;
}

function mergeDisplayOptions(labTest, accessRow) {
    const base = pickDisplayOptions(labTest);
    if (!accessRow?.display_options_customized) {
        return { ...base, display_options_customized: false };
    }
    const merged = { ...base };
    for (const field of DISPLAY_OPTION_FIELDS) {
        if (accessRow[field] !== null && accessRow[field] !== undefined) {
            merged[field] = !!accessRow[field];
        }
    }
    return { ...merged, display_options_customized: true };
}

function applyDisplayOptionsToLabTest(labTest, accessRow) {
    if (!labTest) return labTest;
    return {
        ...labTest,
        ...mergeDisplayOptions(labTest, accessRow),
    };
}

async function loadB2bLabTestAccess(b2bClientId, labTestId) {
    if (!b2bClientId || !labTestId) return null;
    return queryOne(
        `SELECT *
         FROM b2b_client_lab_test_access
         WHERE b2b_client_id = $1
           AND lab_test_id = $2
           AND deleted = false
         LIMIT 1`,
        [b2bClientId, labTestId]
    );
}

/**
 * Resolve which B2B owns this case so we can apply that client's
 * report display options. Order of preference:
 * 1) explicit b2b_client_id
 * 2) waiting_list.b2b_client_id
 * 3) patient.b2b_client_id
 * 4) corporate_clients.b2b_client_id (via corporate_client_id)
 * 5) waiting_test_lab_test.b2b_client_id for this lab test
 */
async function resolveOwnerB2bClientId(context = {}) {
    const {
        b2b_client_id,
        waiting_list_id,
        patient_id,
        corporate_client_id,
        lab_test_id,
        created_by_id,
    } = context;

    if (b2b_client_id) {
        const normalized = await normalizeOwnerB2bClientId(b2b_client_id);
        if (normalized) return normalized;
    }

    if (waiting_list_id) {
        const wl = await queryOne(
            `SELECT b2b_client_id, patient_id, corporate_client_id, created_by_id
             FROM waiting_list
             WHERE id = $1 AND deleted = false
             LIMIT 1`,
            [waiting_list_id]
        );
        if (wl?.b2b_client_id) {
            const normalized = await normalizeOwnerB2bClientId(wl.b2b_client_id);
            if (normalized) return normalized;
        }

        if (wl?.corporate_client_id) {
            const corp = await queryOne(
                `SELECT b2b_client_id FROM corporate_clients WHERE id = $1 AND deleted = false LIMIT 1`,
                [wl.corporate_client_id]
            );
            if (corp?.b2b_client_id) return Number(corp.b2b_client_id);
        }

        if (wl?.patient_id) {
            const pat = await queryOne(
                `SELECT b2b_client_id FROM patient WHERE id = $1 LIMIT 1`,
                [wl.patient_id]
            );
            if (pat?.b2b_client_id) {
                const normalized = await normalizeOwnerB2bClientId(pat.b2b_client_id);
                if (normalized) return normalized;
            }
        }

        if (wl?.created_by_id) {
            const { resolveAdminContext } = require('./adminContext');
            const adminCtx = await resolveAdminContext(wl.created_by_id);
            if (adminCtx.b2b_client_id) return Number(adminCtx.b2b_client_id);
        }

        if (lab_test_id) {
            const wtl = await queryOne(
                `SELECT b2b_client_id
                 FROM waiting_test_lab_test
                 WHERE waiting_list_id = $1
                   AND lab_test_id = $2
                   AND deleted = false
                 LIMIT 1`,
                [waiting_list_id, lab_test_id]
            );
            if (wtl?.b2b_client_id) {
                const normalized = await normalizeOwnerB2bClientId(wtl.b2b_client_id);
                if (normalized) return normalized;
            }
        }
    }

    if (patient_id) {
        const pat = await queryOne(
            `SELECT b2b_client_id, created_by_id FROM patient WHERE id = $1 LIMIT 1`,
            [patient_id]
        );
        if (pat?.b2b_client_id) {
            const normalized = await normalizeOwnerB2bClientId(pat.b2b_client_id);
            if (normalized) return normalized;
        }
        if (pat?.created_by_id) {
            const { resolveAdminContext } = require('./adminContext');
            const adminCtx = await resolveAdminContext(pat.created_by_id);
            if (adminCtx.b2b_client_id) return Number(adminCtx.b2b_client_id);
        }
    }

    if (corporate_client_id) {
        const corp = await queryOne(
            `SELECT b2b_client_id FROM corporate_clients WHERE id = $1 AND deleted = false LIMIT 1`,
            [corporate_client_id]
        );
        if (corp?.b2b_client_id) return Number(corp.b2b_client_id);
    }

    if (created_by_id) {
        const { resolveAdminContext } = require('./adminContext');
        const adminCtx = await resolveAdminContext(created_by_id);
        if (adminCtx.b2b_client_id) return Number(adminCtx.b2b_client_id);
    }

    return null;
}

async function resolveLabTestWithDisplayOptions(labTestId, ownerContext = {}) {
    const labTest = await queryOne(
        `SELECT * FROM lab_tests WHERE id = $1 AND deleted = false LIMIT 1`,
        [labTestId]
    );
    if (!labTest) return { labTest: null, b2bClientId: null };

    const b2bClientId = await resolveOwnerB2bClientId({
        ...ownerContext,
        lab_test_id: labTestId,
    });
    if (!b2bClientId) {
        return {
            labTest: applyDisplayOptionsToLabTest(labTest, null),
            b2bClientId: null,
        };
    }

    const access = await loadB2bLabTestAccess(b2bClientId, labTestId);
    return {
        labTest: applyDisplayOptionsToLabTest(labTest, access),
        b2bClientId,
    };
}

async function applyOwnerDisplayOptions(labTest, ownerContext = {}) {
    if (!labTest) return labTest;
    const { labTest: merged } = await resolveLabTestWithDisplayOptions(labTest.id, {
        ...ownerContext,
        lab_test_id: labTest.id,
    });
    // Keep extra fields already attached on labTest (questions, params, etc.)
    return {
        ...labTest,
        ...pickDisplayOptions(merged || labTest),
        display_options_customized: !!(merged && merged.display_options_customized),
    };
}

module.exports = {
    DISPLAY_OPTION_FIELDS,
    pickDisplayOptions,
    mergeDisplayOptions,
    applyDisplayOptionsToLabTest,
    loadB2bLabTestAccess,
    resolveOwnerB2bClientId,
    resolveLabTestWithDisplayOptions,
    applyOwnerDisplayOptions,
};
