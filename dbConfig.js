require('dotenv').config();

function usesNeonOrSsl(url) {
    if (!url) return false;
    return url.includes('neon.tech') || url.includes('sslmode=require');
}

function getPoolConfig(overrides = {}) {
    if (process.env.DB_URL) {
        return {
            connectionString: process.env.DB_URL,
            ssl: usesNeonOrSsl(process.env.DB_URL)
                ? { rejectUnauthorized: false }
                : undefined,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 15000,
            ...overrides,
        };
    }

    return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'metrolab',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ...overrides,
    };
}

function getDatabaseLabel() {
    if (process.env.DB_URL) {
        try {
            const url = new URL(process.env.DB_URL);
            return `${url.pathname.slice(1) || 'postgres'} @ ${url.hostname}`;
        } catch {
            return 'configured via DB_URL';
        }
    }

    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || '5432';
    const name = process.env.DB_NAME || 'metrolab';
    return `${name} @ ${host}:${port}`;
}

function isManagedDatabase() {
    return Boolean(process.env.DB_URL);
}

module.exports = { getPoolConfig, getDatabaseLabel, isManagedDatabase };
