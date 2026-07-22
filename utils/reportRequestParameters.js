const { query, queryOne } = require('../db');

const TABLE = 'report_request_parameters';

const COPY_FIELDS = [
    'name',
    'description',
    'placeholder',
    'label',
    'input_type',
    'upload_type',
    'validate_regex',
    'is_mandatory',
    'input_option',
    'unit_text',
    'screening_cutoff',
    'confirmation_cutoff',
    'user_id',
    'role_type_id',
];

async function ensureSourceParameterColumn() {
    await query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS source_parameter_id INT;`);
    await query(`
        CREATE INDEX IF NOT EXISTS idx_report_request_parameters_source_b2b
        ON ${TABLE}(source_parameter_id, b2b_client_id)
        WHERE deleted = false
    `);
}

function pickCopyFields(row) {
    const out = {};
    for (const field of COPY_FIELDS) {
        if (row[field] !== undefined) out[field] = row[field];
    }
    return out;
}

function buildEffectiveParamsCte(b2bClientId, labTestId = null, paramIndexStart = 1) {
    const values = [b2bClientId];
    let index = paramIndexStart + 1;
    let labTestFilterGlobal = '';
    let labTestFilterOwn = '';

    if (labTestId != null && labTestId !== '') {
        labTestFilterGlobal = ` AND g.lab_test_id = $${index}`;
        labTestFilterOwn = ` AND o.lab_test_id = $${index}`;
        values.push(Number(labTestId));
        index += 1;
    }

    const fieldSelect = COPY_FIELDS.map(
        (field) => `COALESCE(o.${field}, g.${field}) AS ${field}`,
    ).join(',\n                ');

    const sql = `
        effective_params AS (
            SELECT
                COALESCE(o.id, g.id) AS id,
                COALESCE(o.creation_timestamp, g.creation_timestamp) AS creation_timestamp,
                g.lab_test_id,
                COALESCE(o.b2b_client_id, g.b2b_client_id) AS b2b_client_id,
                ${fieldSelect},
                COALESCE(o.status, g.status) AS status,
                COALESCE(o.deleted, g.deleted) AS deleted,
                COALESCE(o.user_id, g.user_id) AS user_id,
                COALESCE(o.role_type_id, g.role_type_id) AS role_type_id,
                g.id AS global_parameter_id,
                o.id AS override_id,
                CASE WHEN o.id IS NOT NULL THEN true ELSE false END AS is_customized,
                g.id AS source_parameter_id
            FROM ${TABLE} g
            LEFT JOIN ${TABLE} o
              ON o.source_parameter_id = g.id
             AND o.b2b_client_id = $${paramIndexStart}
             AND o.deleted = false
            WHERE g.deleted = false
              AND g.b2b_client_id IS NULL
              ${labTestFilterGlobal}

            UNION ALL

            SELECT
                o.id,
                o.creation_timestamp,
                o.lab_test_id,
                o.b2b_client_id,
                ${COPY_FIELDS.map((field) => `o.${field}`).join(',\n                ')},
                o.status,
                o.deleted,
                o.user_id,
                o.role_type_id,
                NULL::int AS global_parameter_id,
                o.id AS override_id,
                true AS is_customized,
                o.source_parameter_id
            FROM ${TABLE} o
            WHERE o.deleted = false
              AND o.b2b_client_id = $${paramIndexStart}
              AND o.source_parameter_id IS NULL
              ${labTestFilterOwn}
        )`;

    return { sql, values, nextIndex: index };
}

async function listEffectiveParams(b2bClientId, { labTestId = null, activeOnly = false } = {}) {
    await ensureSourceParameterColumn();
    const { sql, values } = buildEffectiveParamsCte(b2bClientId, labTestId, 1);
    let querySql = `WITH ${sql} SELECT * FROM effective_params`;
    if (activeOnly) {
        querySql += ' WHERE status IS DISTINCT FROM false';
    }
    querySql += ' ORDER BY id DESC';
    const { rows } = await query(querySql, values);
    return rows;
}

async function findOverrideForGlobal(globalId, b2bClientId) {
    await ensureSourceParameterColumn();
    return queryOne(
        `SELECT * FROM ${TABLE}
         WHERE source_parameter_id = $1 AND b2b_client_id = $2 AND deleted = false
         LIMIT 1`,
        [globalId, b2bClientId],
    );
}

async function createOverrideFromGlobal(globalRow, b2bClientId, updates = {}) {
    await ensureSourceParameterColumn();
    const base = pickCopyFields(globalRow);
    const merged = { ...base, ...updates };
    const fields = [
        'lab_test_id',
        'b2b_client_id',
        'source_parameter_id',
        ...COPY_FIELDS,
        'status',
    ];
    const values = [
        globalRow.lab_test_id,
        b2bClientId,
        globalRow.id,
        ...COPY_FIELDS.map((field) => merged[field] ?? null),
        merged.status !== undefined ? merged.status : globalRow.status !== false,
    ];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    return queryOne(
        `INSERT INTO ${TABLE} (${fields.join(', ')}, deleted, creation_timestamp)
         VALUES (${placeholders}, false, NOW())
         RETURNING *`,
        values,
    );
}

async function updateOverrideRow(overrideId, updates) {
    const body = { ...updates };
    delete body.id;
    delete body.b2b_client_id;
    delete body.source_parameter_id;
    delete body.lab_test_id;
    delete body.creation_timestamp;
    delete body.deleted;

    const fields = Object.keys(body);
    if (fields.length === 0) {
        return queryOne(`SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`, [overrideId]);
    }

    const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
    const values = fields.map((field) => body[field]);
    values.push(overrideId);
    return queryOne(
        `UPDATE ${TABLE} SET ${setClause} WHERE id = $${values.length} RETURNING *`,
        values,
    );
}

async function upsertB2bOverride(globalRow, b2bClientId, updates = {}) {
    const existing = await findOverrideForGlobal(globalRow.id, b2bClientId);
    if (existing) {
        return updateOverrideRow(existing.id, updates);
    }
    return createOverrideFromGlobal(globalRow, b2bClientId, updates);
}

module.exports = {
    TABLE,
    COPY_FIELDS,
    ensureSourceParameterColumn,
    buildEffectiveParamsCte,
    listEffectiveParams,
    findOverrideForGlobal,
    createOverrideFromGlobal,
    updateOverrideRow,
    upsertB2bOverride,
    pickCopyFields,
};
