const bcrypt = require('bcryptjs');

/** Shown when a valid account exists but status is false. */
const ACCOUNT_DISABLED_MESSAGE =
    'Your account has been disabled. Please contact your administrator.';

/** role_id for the primary Super Admin user — cannot be disabled. */
const MAIN_SUPER_ADMIN_ROLE_ID = 2;

async function passwordMatches(input, stored) {
    if (!stored) return false;
    if (/^\$2[aby]\$/.test(stored)) {
        return bcrypt.compare(input, stored);
    }
    return input === stored;
}

/**
 * Validate credentials for a row already loaded from the database.
 * @returns {{ ok: true, user: object } | { ok: false, code: string, message: string }}
 */
async function validateLoginUser(user, password) {
    if (!user) {
        return { ok: false, code: '401', message: 'Invalid credentials' };
    }
    if (user.status === false) {
        return { ok: false, code: '403', message: ACCOUNT_DISABLED_MESSAGE };
    }
    const match = await passwordMatches(password, user.password);
    if (!match) {
        return { ok: false, code: '401', message: 'Invalid credentials' };
    }
    return { ok: true, user };
}

/**
 * Look up by email and validate login for a single account table.
 * @returns {Promise<{ found: false } | { found: true, result: ReturnType<typeof validateLoginUser> extends Promise<infer R> ? R : never }>}
 */
async function authenticateByEmail(queryOne, table, email, password) {
    const user = await queryOne(
        `SELECT * FROM ${table} WHERE email = $1 AND deleted = false LIMIT 1`,
        [email]
    );
    if (!user) return { found: false };
    const result = await validateLoginUser(user, password);
    return { found: true, result };
}

function isMainSuperAdmin(user) {
    return Number(user?.role_id) === MAIN_SUPER_ADMIN_ROLE_ID;
}

module.exports = {
    ACCOUNT_DISABLED_MESSAGE,
    MAIN_SUPER_ADMIN_ROLE_ID,
    passwordMatches,
    validateLoginUser,
    authenticateByEmail,
    isMainSuperAdmin,
};
