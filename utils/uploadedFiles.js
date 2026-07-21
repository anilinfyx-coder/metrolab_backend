/**
 * Resolve uploaded files from GCS (preferred) or legacy local uploads/ folder.
 * Used by emails and PDF generators that need a local path or buffer.
 */

const fs = require('fs');
const path = require('path');
const {
    PREFIX,
    isGcsConfigured,
    objectExists,
    downloadToTemp,
    downloadBuffer,
} = require('./gcs');

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'metrolab-logo.png');
const FRONTEND_LOGO_PATH = path.join(__dirname, '..', '..', 'metrolab_frontend', 'public', 'login-logo.png');

function findLocalUploadPath(filename) {
    if (!filename) return null;
    const clean = String(filename).trim();
    if (!clean) return null;
    const normalized = clean.replace(/\\/g, '/');
    const baseName = path.basename(normalized);
    const bases = [
        path.join(__dirname, '..'),
        path.join(__dirname, '..', 'uploads'),
        path.join(__dirname, '..', 'uploads', 'b2bClients'),
        path.join(__dirname, '..', 'Uploads', 'b2bClients'),
    ];
    const candidates = [
        clean,
        normalized,
        baseName,
        path.join('uploads', baseName),
        path.join('uploads', 'b2bClients', baseName),
        path.join('Uploads', 'b2bClients', baseName),
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
        for (const base of bases) {
            const full = path.join(base, candidate);
            if (fs.existsSync(full)) return full;
        }
    }
    return null;
}

/**
 * @param {string|null|undefined} filename
 * @param {{ prefix?: string }} [opts]
 * @returns {Promise<string|null>} local filesystem path
 */
async function resolveUploadedFilePath(filename, opts = {}) {
    if (!filename) return null;
    const baseName = path.basename(String(filename).trim());
    if (!baseName) return null;

    const local = findLocalUploadPath(filename);
    if (local) return local;

    if (!isGcsConfigured()) return null;

    const prefixes = opts.prefix
        ? [opts.prefix]
        : [PREFIX.b2bClients, PREFIX.b2bDocuments];

    for (const prefix of prefixes) {
        const objectPath = prefix + baseName;
        try {
            if (await objectExists(objectPath)) {
                return await downloadToTemp(objectPath);
            }
        } catch (err) {
            console.warn(`GCS resolve failed for ${objectPath}:`, err.message);
        }
    }

    // Last attempt: preferred prefix without exists check
    try {
        const objectPath = (opts.prefix || PREFIX.b2bClients) + baseName;
        return await downloadToTemp(objectPath);
    } catch (err) {
        console.warn(`GCS download failed for ${baseName}:`, err.message);
        return null;
    }
}

async function resolveUploadedFileBuffer(filename, opts = {}) {
    if (!filename) return null;
    const baseName = path.basename(String(filename).trim());
    if (!baseName) return null;

    const local = findLocalUploadPath(filename);
    if (local) return fs.readFileSync(local);

    if (!isGcsConfigured()) return null;

    const prefixes = opts.prefix
        ? [opts.prefix]
        : [PREFIX.b2bClients, PREFIX.b2bDocuments];

    for (const prefix of prefixes) {
        const objectPath = prefix + baseName;
        try {
            if (await objectExists(objectPath)) {
                return await downloadBuffer(objectPath);
            }
        } catch (err) {
            console.warn(`GCS buffer resolve failed for ${objectPath}:`, err.message);
        }
    }
    return null;
}

async function resolveDefaultLogoPath() {
    if (fs.existsSync(DEFAULT_LOGO_PATH)) return DEFAULT_LOGO_PATH;
    if (fs.existsSync(FRONTEND_LOGO_PATH)) return FRONTEND_LOGO_PATH;
    return null;
}

/**
 * Resolve lab logo for emails/PDFs (logo_file, then report_header_file, then default).
 * Skips .webp when a better option exists (PDFKit/email compatibility).
 */
async function resolveLabLogoPath(lab) {
    for (const key of ['logo_file', 'report_header_file']) {
        const name = lab?.[key];
        if (!name) continue;
        const resolved = await resolveUploadedFilePath(name, { prefix: PREFIX.b2bClients });
        if (resolved && !resolved.toLowerCase().endsWith('.webp')) {
            return resolved;
        }
    }
    return resolveDefaultLogoPath();
}

module.exports = {
    findLocalUploadPath,
    resolveUploadedFilePath,
    resolveUploadedFileBuffer,
    resolveDefaultLogoPath,
    resolveLabLogoPath,
    DEFAULT_LOGO_PATH,
};
