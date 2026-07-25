const crypto = require('crypto');
const algorithm = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY || 'metrolab_secret_key_012345678901'; // Must be 32 bytes
const IV_LENGTH = 16;

function encryptPII(text) {
    if (!text) return text;
    // If it's already encrypted in our format, don't encrypt again
    if (typeof text === 'string' && text.includes(':') && text.split(':')[0].length === 32) {
        return text;
    }
    
    // For date objects, convert to ISO string before encrypting
    let textStr = text;
    if (text instanceof Date) {
        textStr = text.toISOString().split('T')[0];
    } else {
        textStr = String(text);
    }

    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(textStr);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error('Encryption error:', e);
        return text;
    }
}

function decryptPII(text) {
    if (text == null || text === '') return text;
    // Dates / numbers from drivers — only encrypted payloads are iv:ciphertext strings
    if (text instanceof Date) {
        return text.toISOString().split('T')[0];
    }
    const raw = String(text);
    if (!raw.includes(':')) return raw;
    try {
        const textParts = raw.split(':');
        // Check if the IV looks valid (32 hex chars = 16 bytes)
        if (textParts[0].length !== 32) return raw;

        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        // If decryption fails (e.g. wrong key or malformed), return original
        return raw;
    }
}

/** Common API field names that may hold encrypted DOB / DL / SSN */
const PII_FIELD_KEYS = [
    'dob',
    'ssn',
    'driving_license',
    'patient_dob',
    'patient_ssn',
    'patient_dl',
    'patient_driving_license',
];

/**
 * Decrypt PII fields on a row (mutates and returns the same object).
 * Safe for plaintext values — decryptPII leaves non-encrypted strings unchanged.
 */
function decryptPIIFields(row, extraKeys = []) {
    if (!row || typeof row !== 'object') return row;
    const keys = extraKeys.length ? [...PII_FIELD_KEYS, ...extraKeys] : PII_FIELD_KEYS;
    for (const key of keys) {
        if (row[key] != null && row[key] !== '') {
            row[key] = decryptPII(row[key]);
        }
    }
    return row;
}

function decryptPIIRows(rows, extraKeys = []) {
    if (!Array.isArray(rows)) return rows;
    return rows.map((row) => decryptPIIFields(row, extraKeys));
}

module.exports = {
    encryptPII,
    decryptPII,
    decryptPIIFields,
    decryptPIIRows,
    PII_FIELD_KEYS,
};
