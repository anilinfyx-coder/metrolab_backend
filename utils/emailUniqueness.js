const { queryOne } = require('../db');

/**
 * Login emails must be unique across these 3 registration tables only.
 * If the email exists in ANY one → block create/update.
 * If it exists in NONE → allow create.
 */
const LOGIN_EMAIL_SOURCES = [
    { table: 'admin_users', label: 'Admin User' },
    { table: 'b2b_clients', label: 'B2B Lab' },
    { table: 'corporate_clients', label: 'Corporate Client' },
];

function normalizeLoginEmail(email) {
    return String(email || '').trim().toLowerCase();
}

/**
 * Find if a login email already exists in any of the 3 tables.
 * @param {string} email
 * @param {{ table?: string, id?: number|string }} [exclude] - current record on update
 * @returns {Promise<{ table: string, label: string, id: number }|null>}
 */
async function findLoginEmailConflict(email, exclude = {}) {
    const normalized = normalizeLoginEmail(email);
    if (!normalized) return null;

    const excludeTable = exclude.table || null;
    const excludeId = exclude.id != null ? Number(exclude.id) : null;

    for (const source of LOGIN_EMAIL_SOURCES) {
        const row = await queryOne(
            `SELECT id, email FROM ${source.table}
             WHERE LOWER(TRIM(email)) = $1 AND deleted = false
             LIMIT 1`,
            [normalized]
        );
        if (!row) continue;
        // Same row being updated — not a conflict
        if (excludeTable === source.table && excludeId != null && Number(row.id) === excludeId) {
            continue;
        }
        return { table: source.table, label: source.label, id: row.id };
    }

    return null;
}

/**
 * Allow create only when email is not found in admin_users, b2b_clients, or corporate_clients.
 * @returns {{ ok: true, email: string } | { ok: false, code: string, message: string }}
 */
async function validateUniqueLoginEmail(email, exclude = {}) {
    const normalized = normalizeLoginEmail(email);
    if (!normalized) {
        return { ok: false, code: '400', message: 'Email address is required.' };
    }

    const conflict = await findLoginEmailConflict(normalized, exclude);
    if (conflict) {
        return {
            ok: false,
            code: '409',
            message: 'This email is already registered. Please use a different email address.',
        };
    }

    return { ok: true, email: normalized };
}

module.exports = {
    LOGIN_EMAIL_SOURCES,
    normalizeLoginEmail,
    findLoginEmailConflict,
    validateUniqueLoginEmail,
};
