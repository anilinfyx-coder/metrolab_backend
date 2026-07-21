const { queryOne } = require('../db');

/**
 * Resolve B2B + corporate ownership for an admin_users row.
 * admin_users.user_id may point to:
 * - b2b_clients.id (B2B staff admin)
 * - corporate_clients.id (corporate-linked admin)
 */
async function resolveAdminContext(adminUserId) {
    if (!adminUserId) {
        return {
            created_by_id: null,
            b2b_client_id: null,
            corporate_client_id: null,
            user_id: null,
            role_type_id: null,
        };
    }

    const admin = await queryOne(
        `SELECT id, user_id, role_type_id
         FROM admin_users
         WHERE id = $1 AND deleted = false
         LIMIT 1`,
        [adminUserId]
    );

    if (!admin) {
        return {
            created_by_id: adminUserId,
            b2b_client_id: null,
            corporate_client_id: null,
            user_id: adminUserId,
            role_type_id: null,
        };
    }

    let b2bClientId = null;
    let corporateClientId = null;
    let ownerUserId = admin.user_id || adminUserId;

    if (admin.user_id) {
        const b2b = await queryOne(
            `SELECT id FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
            [admin.user_id]
        );
        if (b2b) {
            b2bClientId = Number(b2b.id);
        } else {
            const corp = await queryOne(
                `SELECT id, b2b_client_id
                 FROM corporate_clients
                 WHERE id = $1 AND deleted = false
                 LIMIT 1`,
                [admin.user_id]
            );
            if (corp) {
                corporateClientId = Number(corp.id);
                if (corp.b2b_client_id) b2bClientId = Number(corp.b2b_client_id);
            }
        }
    }

    return {
        created_by_id: adminUserId,
        b2b_client_id: b2bClientId,
        corporate_client_id: corporateClientId,
        user_id: ownerUserId,
        role_type_id: admin.role_type_id || null,
    };
}

/**
 * Normalize a stored owner id that may be a B2B id or a corporate id.
 */
async function normalizeOwnerB2bClientId(candidateId) {
    if (!candidateId) return null;

    const b2b = await queryOne(
        `SELECT id FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1`,
        [candidateId]
    );
    if (b2b) return Number(b2b.id);

    const corp = await queryOne(
        `SELECT b2b_client_id FROM corporate_clients WHERE id = $1 AND deleted = false LIMIT 1`,
        [candidateId]
    );
    if (corp?.b2b_client_id) return Number(corp.b2b_client_id);

    return null;
}

module.exports = {
    resolveAdminContext,
    normalizeOwnerB2bClientId,
};
