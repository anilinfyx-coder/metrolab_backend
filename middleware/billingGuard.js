const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./auth');
const { queryOne } = require('../db');

/**
 * Middleware to restrict POST, PUT, DELETE actions for B2B Clients and B2B Admins
 * if they do not have a valid subscription or sufficient wallet balance.
 */
const billingGuard = async (req, res, next) => {
    // 1. Allow all GET and OPTIONS requests so they can view the dashboard
    if (req.method === 'GET' || req.method === 'OPTIONS') {
        return next();
    }

    // 2. Decode the JWT manually since this runs before route-specific authMiddleware
    const token = req.headers['token'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return next(); // Let authMiddleware reject it later

    let decodedUser;
    try {
        decodedUser = jwt.verify(token, JWT_SECRET);
        req.user = decodedUser;
    } catch (err) {
        return next(); // Let authMiddleware reject the invalid token
    }

    const { id, portal } = decodedUser;

    // We only restrict 'b2b' and 'admin' (which works on behalf of B2B)
    if (portal !== 'b2b' && portal !== 'admin') {
        return next();
    }

    try {
        let b2bClientId = null;

        if (portal === 'b2b') {
            b2bClientId = id;
        } else if (portal === 'admin') {
            // Retrieve the b2b_client_id (stored as user_id) for this admin
            const adminUser = await queryOne('SELECT user_id FROM admin_users WHERE id = $1', [id]);
            if (adminUser && adminUser.user_id) {
                b2bClientId = adminUser.user_id;
            } else {
                // If this admin doesn't belong to a B2B client, allow them
                return next();
            }
        }

        if (!b2bClientId) {
            return next();
        }

        // 2. Fetch Billing Configuration for the B2B Client
        const b2bClient = await queryOne(
            'SELECT wallet_balance, billing_mode, deleted FROM b2b_clients WHERE id = $1 LIMIT 1',
            [b2bClientId]
        );

        if (!b2bClient || b2bClient.deleted) {
            return res.status(403).json({ 
                response_code: '403', 
                obj: 'Account not found or deleted.' 
            });
        }

        const billingMode = b2bClient.billing_mode || 'monthly';
        const walletBalance = parseFloat(b2bClient.wallet_balance || 0);

        // 3. Enforce Billing Rules based on Mode
        if (billingMode === 'custom') {
            // Custom Pricing: Must have a positive wallet balance
            if (walletBalance <= 0) {
                return res.status(403).json({
                    response_code: '403',
                    obj: 'Billing Restriction: Wallet balance is zero or negative. Please recharge your wallet to perform actions.'
                });
            }
        } else {
            // Monthly/Yearly: Must have an active subscription
            const activeSub = await queryOne(
                `SELECT id FROM b2b_client_subscription 
                 WHERE b2b_client_id = $1 
                 AND deleted = false 
                 AND start_date <= CURRENT_DATE 
                 AND end_date >= CURRENT_DATE 
                 LIMIT 1`,
                [b2bClientId]
            );

            if (!activeSub) {
                return res.status(403).json({
                    response_code: '403',
                    obj: 'Billing Restriction: Your subscription has expired. Please contact support to renew before performing actions.'
                });
            }
        }

        // Passed all checks, allow the action
        next();

    } catch (err) {
        console.error('Billing Guard Error:', err);
        return res.status(500).json({ response_code: '500', obj: 'Internal server error while verifying billing status.' });
    }
};

module.exports = { billingGuard };
