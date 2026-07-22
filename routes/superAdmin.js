const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { validateLoginUser, isMainSuperAdmin } = require('../utils/loginAuth');
const { validateUniqueLoginEmail, normalizeLoginEmail } = require('../utils/emailUniqueness');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

// ── POST /api/SuperAdmin/login ────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await queryOne(
            `SELECT * FROM super_admin WHERE email = $1 AND deleted = false LIMIT 1`,
            [username]
        );
        const auth = await validateLoginUser(user, password);
        if (!auth.ok) return resp(res, auth.code, auth.message);

        const token = jwt.sign(
            { id: auth.user.id, email: auth.user.email, role_id: auth.user.role_id, role_type_id: auth.user.role_type_id, portal: 'superadmin' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.setHeader('token', token);
        return resp(res, '200', {
            id: auth.user.id, name: auth.user.name, email: auth.user.email,
            mobile: auth.user.mobile, role: auth.user.role_id, portal: 'superadmin', token
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// ── Dashboard & Profile Routes (Protected) ───────────────────
router.use(authMiddleware);

// Simple in-memory cache for dashboard stats
let dashboardCache = {
    data: null,
    lastFetch: 0
};
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

router.get('/dashboardStats', async (req, res) => {
    try {
        const now = Date.now();
        // Return cached data if valid
        if (dashboardCache.data && (now - dashboardCache.lastFetch < CACHE_TTL)) {
            return resp(res, '200', dashboardCache.data);
        }

        // Run counting queries in parallel for faster execution
        const [b2b, corporate, completedLabTests, patients, activeSubs] = await Promise.all([
            queryOne('SELECT COUNT(*) as count FROM b2b_clients WHERE deleted = false'),
            queryOne('SELECT COUNT(*) as count FROM corporate_clients WHERE deleted = false'),
            queryOne('SELECT COUNT(*) as count FROM lab_test_category_report WHERE deleted = false'),
            queryOne('SELECT COUNT(*) as count FROM patient WHERE deleted = false'),
            queryOne(`SELECT COUNT(*) as count
                      FROM b2b_client_subscription s
                      INNER JOIN b2b_clients b ON b.id = s.b2b_client_id AND b.deleted = false
                      WHERE s.deleted = false
                        AND s.status IS DISTINCT FROM false
                        AND s.start_date <= CURRENT_DATE
                        AND s.end_date >= CURRENT_DATE`)
        ]);
        
        const data = {
            total_b2b_clients: parseInt(b2b.count, 10),
            total_corporate_clients: parseInt(corporate.count, 10),
            total_lab_tests: parseInt(completedLabTests.count, 10),
            total_patients: parseInt(patients.count, 10),
            total_active_subscriptions: parseInt(activeSubs.count, 10)
        };

        // Update cache
        dashboardCache.data = data;
        dashboardCache.lastFetch = now;

        return resp(res, '200', data);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/topCompletedLabTests — most completed/used lab tests (top N)
router.get('/topCompletedLabTests', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const { rows } = await query(
            `SELECT lt.id AS lab_test_id,
                    lt.name AS lab_test_name,
                    COUNT(r.id)::int AS completed_count
             FROM lab_test_category_report r
             INNER JOIN lab_tests lt ON lt.id = r.lab_test_id AND lt.deleted = false
             WHERE r.deleted = false
             GROUP BY lt.id, lt.name
             ORDER BY completed_count DESC, lt.name ASC
             LIMIT $1`,
            [limit]
        );
        return resp(res, '200', rows);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/latestB2bClients — recently added B2B clients (for dashboard)
router.get('/latestB2bClients', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const { rows } = await query(
            `SELECT id, company_name, contact_person_name, mobile, email, wallet_balance, status, creation_timestamp
             FROM b2b_clients
             WHERE deleted = false
             ORDER BY creation_timestamp DESC NULLS LAST, id DESC
             LIMIT $1`,
            [limit]
        );
        return resp(res, '200', rows);
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/labTestActivity?range=7d|30d
router.get('/labTestActivity', async (req, res) => {
    try {
        const range = String(req.query.range || '7d').toLowerCase() === '30d' ? 30 : 7;
        const { rows } = await query(
            `WITH days AS (
                SELECT generate_series(
                    CURRENT_DATE - ($1::int - 1),
                    CURRENT_DATE,
                    '1 day'::interval
                )::date AS day
             ),
             counts AS (
                SELECT creation_timestamp::date AS day, COUNT(*)::int AS count
                FROM lab_test_category_report
                WHERE deleted = false
                  AND creation_timestamp >= (CURRENT_DATE - ($1::int - 1))
                  AND creation_timestamp < (CURRENT_DATE + 1)
                GROUP BY creation_timestamp::date
             )
             SELECT
                to_char(d.day, 'YYYY-MM-DD') AS date,
                to_char(d.day, 'Mon DD') AS label,
                COALESCE(c.count, 0)::int AS count
             FROM days d
             LEFT JOIN counts c ON c.day = d.day
             ORDER BY d.day ASC`,
            [range]
        );
        return resp(res, '200', { range: `${range}d`, items: rows });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/testStatusDistribution — Completed vs Pending assigned waiting tests
router.get('/testStatusDistribution', async (req, res) => {
    try {
        const row = await queryOne(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE r.waiting_list_id IS NOT NULL)::int AS completed,
                COUNT(*) FILTER (WHERE r.waiting_list_id IS NULL)::int AS pending
             FROM waiting_test_lab_test wtl
             INNER JOIN waiting_list wl
               ON wl.id = wtl.waiting_list_id
              AND wl.deleted = false
             LEFT JOIN (
                SELECT DISTINCT waiting_list_id, lab_test_id
                FROM lab_test_category_report
                WHERE deleted = false
             ) r
               ON r.waiting_list_id = wl.id
              AND r.lab_test_id = wtl.lab_test_id
             WHERE wtl.deleted = false`
        );
        const completed = parseInt(row?.completed || 0, 10);
        const pending = parseInt(row?.pending || 0, 10);
        const total = parseInt(row?.total || 0, 10);
        return resp(res, '200', { completed, pending, total });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/dashboardOverview — one round-trip for dashboard widgets
router.get('/dashboardOverview', async (req, res) => {
    try {
        const activityRange = String(req.query.activityRange || '7d').toLowerCase() === '30d' ? 30 : 7;
        const revenueMonths = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
        const listLimit = 5;
        const lowWalletThreshold = 50;

        const [
            b2b,
            corporate,
            completedLabTests,
            patients,
            activeSubsCount,
            latestB2b,
            activeSubs,
            topTests,
            activityRows,
            statusRow,
            revenueRows,
            expiring,
            expired,
            lowWallets,
        ] = await Promise.all([
            queryOne('SELECT COUNT(*)::int AS count FROM b2b_clients WHERE deleted = false'),
            queryOne('SELECT COUNT(*)::int AS count FROM corporate_clients WHERE deleted = false'),
            queryOne('SELECT COUNT(*)::int AS count FROM lab_test_category_report WHERE deleted = false'),
            queryOne('SELECT COUNT(*)::int AS count FROM patient WHERE deleted = false'),
            queryOne(`SELECT COUNT(*)::int AS count
                      FROM b2b_client_subscription s
                      INNER JOIN b2b_clients b ON b.id = s.b2b_client_id AND b.deleted = false
                      WHERE s.deleted = false
                        AND s.status IS DISTINCT FROM false
                        AND s.start_date <= CURRENT_DATE
                        AND s.end_date >= CURRENT_DATE`),
            query(
                `SELECT id, company_name, contact_person_name, mobile, email, wallet_balance, status, creation_timestamp
                 FROM b2b_clients
                 WHERE deleted = false
                 ORDER BY creation_timestamp DESC NULLS LAST, id DESC
                 LIMIT $1`,
                [listLimit]
            ),
            query(
                `SELECT s.id, s.b2b_client_id, s.start_date, s.end_date, s.amount, s.creation_timestamp,
                        b.company_name, b.contact_person_name, b.email, b.mobile
                 FROM b2b_client_subscription s
                 INNER JOIN b2b_clients b ON b.id = s.b2b_client_id AND b.deleted = false
                 WHERE s.deleted = false
                   AND s.status IS DISTINCT FROM false
                   AND s.start_date <= CURRENT_DATE
                   AND s.end_date >= CURRENT_DATE
                 ORDER BY s.end_date ASC, s.id DESC
                 LIMIT $1`,
                [listLimit]
            ),
            query(
                `SELECT lt.id AS lab_test_id,
                        lt.name AS lab_test_name,
                        COUNT(r.id)::int AS completed_count
                 FROM lab_test_category_report r
                 INNER JOIN lab_tests lt ON lt.id = r.lab_test_id AND lt.deleted = false
                 WHERE r.deleted = false
                 GROUP BY lt.id, lt.name
                 ORDER BY completed_count DESC, lt.name ASC
                 LIMIT $1`,
                [listLimit]
            ),
            query(
                `WITH days AS (
                    SELECT generate_series(
                        CURRENT_DATE - ($1::int - 1),
                        CURRENT_DATE,
                        '1 day'::interval
                    )::date AS day
                 ),
                 counts AS (
                    SELECT creation_timestamp::date AS day, COUNT(*)::int AS count
                    FROM lab_test_category_report
                    WHERE deleted = false
                      AND creation_timestamp >= (CURRENT_DATE - ($1::int - 1))
                      AND creation_timestamp < (CURRENT_DATE + 1)
                    GROUP BY creation_timestamp::date
                 )
                 SELECT
                    to_char(d.day, 'YYYY-MM-DD') AS date,
                    to_char(d.day, 'Mon DD') AS label,
                    COALESCE(c.count, 0)::int AS count
                 FROM days d
                 LEFT JOIN counts c ON c.day = d.day
                 ORDER BY d.day ASC`,
                [activityRange]
            ),
            queryOne(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE r.waiting_list_id IS NOT NULL)::int AS completed,
                    COUNT(*) FILTER (WHERE r.waiting_list_id IS NULL)::int AS pending
                 FROM waiting_test_lab_test wtl
                 INNER JOIN waiting_list wl
                   ON wl.id = wtl.waiting_list_id
                  AND wl.deleted = false
                 LEFT JOIN (
                    SELECT DISTINCT waiting_list_id, lab_test_id
                    FROM lab_test_category_report
                    WHERE deleted = false
                 ) r
                   ON r.waiting_list_id = wl.id
                  AND r.lab_test_id = wtl.lab_test_id
                 WHERE wtl.deleted = false`
            ),
            query(
                `WITH months AS (
                    SELECT date_trunc('month', CURRENT_DATE) - (n || ' months')::interval AS month_start
                    FROM generate_series(0, $1::int - 1) AS n
                 )
                 SELECT
                    to_char(m.month_start, 'YYYY-MM') AS month_key,
                    to_char(m.month_start, 'Mon ''YY') AS label,
                    COALESCE(SUM(s.amount), 0)::float AS revenue,
                    COUNT(s.id)::int AS subscriptions
                 FROM months m
                 LEFT JOIN b2b_client_subscription s
                   ON s.deleted = false
                  AND date_trunc('month', COALESCE(s.creation_timestamp::date, s.start_date)) = m.month_start
                 GROUP BY m.month_start
                 ORDER BY m.month_start ASC`,
                [revenueMonths]
            ),
            queryOne(
                `SELECT COUNT(*)::int AS count
                 FROM b2b_client_subscription s
                 INNER JOIN b2b_clients b ON b.id = s.b2b_client_id AND b.deleted = false
                 WHERE s.deleted = false
                   AND s.status IS DISTINCT FROM false
                   AND s.end_date >= CURRENT_DATE
                   AND s.end_date <= CURRENT_DATE + INTERVAL '7 days'`
            ),
            queryOne(
                `SELECT COUNT(DISTINCT b.id)::int AS count
                 FROM b2b_clients b
                 WHERE b.deleted = false
                   AND NOT EXISTS (
                        SELECT 1
                        FROM b2b_client_subscription s
                        WHERE s.b2b_client_id = b.id
                          AND s.deleted = false
                          AND s.status IS DISTINCT FROM false
                          AND s.start_date <= CURRENT_DATE
                          AND s.end_date >= CURRENT_DATE
                   )
                   AND EXISTS (
                        SELECT 1
                        FROM b2b_client_subscription s
                        WHERE s.b2b_client_id = b.id
                          AND s.deleted = false
                          AND s.end_date < CURRENT_DATE
                   )`
            ),
            queryOne(
                `SELECT COUNT(*)::int AS count
                 FROM b2b_clients
                 WHERE deleted = false
                   AND COALESCE(wallet_balance, 0) <= $1`,
                [lowWalletThreshold]
            ),
        ]);

        return resp(res, '200', {
            stats: {
                total_b2b_clients: parseInt(b2b?.count || 0, 10),
                total_corporate_clients: parseInt(corporate?.count || 0, 10),
                total_lab_tests: parseInt(completedLabTests?.count || 0, 10),
                total_patients: parseInt(patients?.count || 0, 10),
                total_active_subscriptions: parseInt(activeSubsCount?.count || 0, 10),
            },
            latest_b2b_clients: latestB2b.rows || [],
            active_subscriptions: activeSubs.rows || [],
            top_lab_tests: topTests.rows || [],
            activity: {
                range: `${activityRange}d`,
                items: activityRows.rows || [],
            },
            status_distribution: {
                completed: parseInt(statusRow?.completed || 0, 10),
                pending: parseInt(statusRow?.pending || 0, 10),
                total: parseInt(statusRow?.total || 0, 10),
            },
            revenue: {
                months: revenueMonths,
                items: revenueRows.rows || [],
            },
            alerts: {
                expiring_subscriptions: parseInt(expiring?.count || 0, 10),
                expired_subscriptions: parseInt(expired?.count || 0, 10),
                low_wallets: parseInt(lowWallets?.count || 0, 10),
                low_wallet_threshold: lowWalletThreshold,
            },
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/revenueSubscriptionOverview?months=6
router.get('/revenueSubscriptionOverview', async (req, res) => {
    try {
        const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
        const { rows } = await query(
            `WITH months AS (
                SELECT date_trunc('month', CURRENT_DATE) - (n || ' months')::interval AS month_start
                FROM generate_series(0, $1::int - 1) AS n
             )
             SELECT
                to_char(m.month_start, 'YYYY-MM') AS month_key,
                to_char(m.month_start, 'Mon ''YY') AS label,
                COALESCE(SUM(s.amount), 0)::float AS revenue,
                COUNT(s.id)::int AS subscriptions
             FROM months m
             LEFT JOIN b2b_client_subscription s
               ON s.deleted = false
              AND date_trunc('month', COALESCE(s.creation_timestamp::date, s.start_date)) = m.month_start
             GROUP BY m.month_start
             ORDER BY m.month_start ASC`,
            [months]
        );
        return resp(res, '200', { months, items: rows });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

// GET /api/SuperAdmin/dashboardAlerts — aggregated subscription + wallet alerts
router.get('/dashboardAlerts', async (req, res) => {
    try {
        const lowWalletThreshold = 50;
        const [expiring, expired, lowWallets] = await Promise.all([
            queryOne(
                `SELECT COUNT(*)::int AS count
                 FROM b2b_client_subscription s
                 INNER JOIN b2b_clients b ON b.id = s.b2b_client_id AND b.deleted = false
                 WHERE s.deleted = false
                   AND s.status IS DISTINCT FROM false
                   AND s.end_date >= CURRENT_DATE
                   AND s.end_date <= CURRENT_DATE + INTERVAL '7 days'`
            ),
            queryOne(
                `SELECT COUNT(DISTINCT b.id)::int AS count
                 FROM b2b_clients b
                 WHERE b.deleted = false
                   AND NOT EXISTS (
                        SELECT 1
                        FROM b2b_client_subscription s
                        WHERE s.b2b_client_id = b.id
                          AND s.deleted = false
                          AND s.status IS DISTINCT FROM false
                          AND s.start_date <= CURRENT_DATE
                          AND s.end_date >= CURRENT_DATE
                   )
                   AND EXISTS (
                        SELECT 1
                        FROM b2b_client_subscription s
                        WHERE s.b2b_client_id = b.id
                          AND s.deleted = false
                          AND s.end_date < CURRENT_DATE
                   )`
            ),
            queryOne(
                `SELECT COUNT(*)::int AS count
                 FROM b2b_clients
                 WHERE deleted = false
                   AND COALESCE(wallet_balance, 0) <= $1`,
                [lowWalletThreshold]
            ),
        ]);

        return resp(res, '200', {
            expiring_subscriptions: parseInt(expiring?.count || 0, 10),
            expired_subscriptions: parseInt(expired?.count || 0, 10),
            low_wallets: parseInt(lowWallets?.count || 0, 10),
            low_wallet_threshold: lowWalletThreshold,
        });
    } catch (err) {
        console.error(err);
        return resp(res, '500', err.message);
    }
});

router.post('/getProfile', async (req, res) => {
    try {
        const userId = req.body.id || req.user.id;
        const user = await queryOne(
            `SELECT id, name, email, mobile, role_id, status FROM super_admin WHERE id = $1 AND deleted = false LIMIT 1`,
            [userId]
        );
        if (!user) return resp(res, '404', 'User not found');
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.post('/updateProfile', async (req, res) => {
    try {
        const { name, email, mobile } = req.body;
        const userId = req.user.id;
        await queryOne(
            `UPDATE super_admin SET name = $1, email = $2, mobile = $3 WHERE id = $4`,
            [name, email, mobile, userId]
        );
        return resp(res, '200', 'Profile Updated Successfully');
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

router.post('/changePassword', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;
        
        const user = await queryOne(`SELECT password FROM super_admin WHERE id = $1 LIMIT 1`, [userId]);
        if (!user) return resp(res, '404', 'User not found');
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return resp(res, '400', 'Current password is incorrect');
        
        const hashed = await bcrypt.hash(newPassword, 10);
        await queryOne(`UPDATE super_admin SET password = $1 WHERE id = $2`, [hashed, userId]);
        
        return resp(res, '200', 'Password Changed Successfully');
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/SuperAdmin ──────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted
             FROM super_admin 
             WHERE deleted = false AND role_id != 1 
             ORDER BY id DESC`
        );
        return resp(res, '200', rows);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── GET /api/SuperAdmin/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const user = await queryOne(
            `SELECT id, name, email, mobile, role_id, role_type_id, uid, image_file, user_id, status, deleted
             FROM super_admin WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!user) return resp(res, '404', 'Super Admin not found');
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── POST /api/SuperAdmin ─────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        if (!isMainSuperAdmin(req.user)) {
            return resp(res, '403', 'Only the Main Super Admin can register new staff.');
        }

        const { name, email, mobile, password, role_id, role_type_id, uid, image_file, user_id } = req.body;

        const emailCheck = await validateUniqueLoginEmail(email);
        if (!emailCheck.ok) return resp(res, emailCheck.code, emailCheck.message);

        const hashed = await bcrypt.hash(password, 10);
        const user = await queryOne(
            `INSERT INTO super_admin (name, email, mobile, password, role_id, role_type_id, uid, image_file, user_id, status, deleted, creation_timestamp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,NOW()) RETURNING *`,
            [name, normalizeLoginEmail(email), mobile, hashed, role_id, role_type_id, uid, image_file, user_id]
        );
        return resp(res, '200', user);
    } catch (err) {
        return resp(res, '500', err.message);
    }
});

// ── PUT /api/SuperAdmin/:id ──────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        if (!isMainSuperAdmin(req.user)) {
            return resp(res, '403', 'Only the Main Super Admin can modify staff details.');
        }

        const existing = await queryOne(
            `SELECT id, role_id FROM super_admin WHERE id = $1 AND deleted = false LIMIT 1`,
            [req.params.id]
        );
        if (!existing) return resp(res, '404', 'Super Admin not found');

        if (isMainSuperAdmin(existing) && req.body.status === false) {
            return resp(res, '400', 'Main Super Admin account cannot be disabled.');
        }

        const { name, email, mobile, password, role_id, status } = req.body;

        if (email !== undefined && email !== null) {
            const emailCheck = await validateUniqueLoginEmail(email, {
                table: 'super_admin',
                id: req.params.id,
            });
            if (!emailCheck.ok) return resp(res, emailCheck.code, emailCheck.message);
        }

        let setClause = 'name = COALESCE($1, name), email = COALESCE($2, email), mobile = COALESCE($3, mobile), role_id = COALESCE($4, role_id), status = COALESCE($5, status)';
        const values = [name, email != null ? normalizeLoginEmail(email) : email, mobile, role_id, status];
        let index = 6;
        if (password) {
            setClause += `, password = $${index++}`;
            values.push(await bcrypt.hash(password, 10));
        }
        values.push(req.params.id);
        
        const row = await queryOne(
            `UPDATE super_admin SET ${setClause} WHERE id = $${index} RETURNING *`,
            values
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

// ── DELETE /api/SuperAdmin/:id ───────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        if (!isMainSuperAdmin(req.user)) {
            return resp(res, '403', 'Only the Main Super Admin can delete staff.');
        }

        const row = await queryOne(
            `UPDATE super_admin SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
            [req.params.id]
        );
        return resp(res, '200', row);
    } catch (err) { return resp(res, '500', err.message); }
});

module.exports = router;
