// Google Cloud Storage helper used for durable file uploads (Cloud Run's
// container filesystem is ephemeral/per-instance, so uploaded files must not
// be written to local disk).
//
// Auth: uses Application Default Credentials - the attached Cloud Run
// service account in production, or `gcloud auth application-default login`
// locally. Signed URLs are generated via the IAM signBlob API (no service
// account key file needed), which requires the identity to hold
// roles/iam.serviceAccountTokenCreator on itself.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();

/** Set your bucket name here (or via GCS_BUCKET env). */
const GCS_BUCKET_NAME = process.env.GCS_BUCKET || '';

const PREFIX = {
    b2bClients: 'b2b-clients/',
    b2bDocuments: 'b2b-client-documents/',
};

function getBucketName() {
    return String(GCS_BUCKET_NAME || '').trim();
}

function isGcsConfigured() {
    return Boolean(getBucketName());
}

function getBucket() {
    const bucketName = getBucketName();
    if (!bucketName) {
        throw new Error('GCS_BUCKET is not set. Set GCS_BUCKET env or update GCS_BUCKET_NAME in utils/gcs.js');
    }
    return storage.bucket(bucketName);
}

function objectPathFor(filename, prefix = PREFIX.b2bClients) {
    const base = path.basename(String(filename || '').trim());
    if (!base) return null;
    return `${prefix}${base}`;
}

async function uploadBuffer(buffer, objectPath, contentType) {
    const file = getBucket().file(objectPath);
    await file.save(buffer, {
        contentType: contentType || 'application/octet-stream',
        resumable: false,
        metadata: {
            cacheControl: 'public, max-age=31536000',
        },
    });
    return objectPath;
}

async function deleteObject(objectPath) {
    try {
        await getBucket().file(objectPath).delete();
    } catch (err) {
        if (err.code !== 404) throw err;
    }
}

async function objectExists(objectPath) {
    try {
        const [exists] = await getBucket().file(objectPath).exists();
        return exists;
    } catch {
        return false;
    }
}

async function downloadBuffer(objectPath) {
    const [buf] = await getBucket().file(objectPath).download();
    return buf;
}

/**
 * Download GCS object to a temp file and return the local path (for PDFKit / nodemailer).
 */
async function downloadToTemp(objectPath) {
    const buf = await downloadBuffer(objectPath);
    const ext = path.extname(objectPath) || '.bin';
    const tmpPath = path.join(os.tmpdir(), `metrolab-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    fs.writeFileSync(tmpPath, buf);
    return tmpPath;
}

async function getSignedUrl(objectPath, expiresInMs = 60 * 60 * 1000) {
    const [url] = await getBucket().file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMs,
    });
    return url;
}

/**
 * Resolve a stored filename to a short-lived signed read URL.
 * Tries b2b-clients/ then b2b-client-documents/.
 */
async function getSignedUrlForFilename(filename, preferredPrefix = null) {
    const base = path.basename(String(filename || '').trim());
    if (!base) return null;

    const prefixes = preferredPrefix
        ? [preferredPrefix]
        : [PREFIX.b2bClients, PREFIX.b2bDocuments];

    for (const prefix of prefixes) {
        const objectPath = prefix + base;
        if (await objectExists(objectPath)) {
            return getSignedUrl(objectPath);
        }
    }
    // Fallback: assume preferred / default prefix even if exists check fails
    const fallback = (preferredPrefix || PREFIX.b2bClients) + base;
    return getSignedUrl(fallback);
}

function generateFileName(originalName) {
    const safe = String(originalName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    return `${uniqueSuffix}-${safe}`;
}

module.exports = {
    PREFIX,
    GCS_BUCKET_NAME,
    getBucketName,
    isGcsConfigured,
    getBucket,
    objectPathFor,
    uploadBuffer,
    deleteObject,
    objectExists,
    downloadBuffer,
    downloadToTemp,
    getSignedUrl,
    getSignedUrlForFilename,
    generateFileName,
};
