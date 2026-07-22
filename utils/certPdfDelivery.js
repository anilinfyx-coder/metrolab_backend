const { buildAdultHealthCertPdf } = require('./adultHealthCertPdf');
const { buildPhysicalExamCertPdf } = require('./physicalExamCertPdf');

/**
 * Single PDF builder for download + email — same layout, branding, and checkmarks.
 */
async function buildAdultHealthCertForDelivery(id, authUser) {
    return buildAdultHealthCertPdf(id, { encrypt: false, authUser });
}

async function buildPhysicalExamCertForDelivery(id, authUser) {
    return buildPhysicalExamCertPdf(id, { encrypt: false, authUser });
}

module.exports = {
    buildAdultHealthCertForDelivery,
    buildPhysicalExamCertForDelivery,
};
