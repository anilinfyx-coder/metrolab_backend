const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'metrolab_secret_2024';

const authMiddleware = (req, res, next) => {
    const token = req.headers['token'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ response_code: '401', obj: 'Unauthorized: No token provided' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ response_code: '401', obj: 'Unauthorized: Invalid token' });
    }
};

module.exports = { authMiddleware, JWT_SECRET };
