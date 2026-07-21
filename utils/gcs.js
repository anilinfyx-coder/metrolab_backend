// Google Cloud Storage helper used for durable file uploads (Cloud Run's
// container filesystem is ephemeral/per-instance, so uploaded files must not
// be written to local disk).
//
// Auth: uses Application Default Credentials - the attached Cloud Run
// service account in production, or `gcloud auth application-default login`
// locally. Signed URLs are generated via the IAM signBlob API (no service
// account key file needed), which requires the identity to hold
// roles/iam.serviceAccountTokenCreator on itself.

const { Storage } = require('@google-cloud/storage');

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET;

function getBucket() {
    if (!bucketName) {
        throw new Error('GCS_BUCKET environment variable is not set');
    }
    return storage.bucket(bucketName);
}

async function uploadBuffer(buffer, objectPath, contentType) {
    const file = getBucket().file(objectPath);
    await file.save(buffer, {
        contentType: contentType || 'application/octet-stream',
        resumable: false,
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

async function getSignedUrl(objectPath, expiresInMs = 15 * 60 * 1000) {
    const [url] = await getBucket().file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMs,
    });
    return url;
}

function generateFileName(originalName) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    return `${uniqueSuffix}-${originalName}`;
}

module.exports = { getBucket, uploadBuffer, deleteObject, getSignedUrl, generateFileName };
