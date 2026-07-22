const { buildLabTestReportPdf } = require('./labTestReportPdf');

/**
 * Single PDF builder for download + email — same layout, branding, and logo rules as certificates.
 */
async function buildLabTestReportForDelivery(reportId, authUser) {
    return buildLabTestReportPdf(reportId, { encrypt: false, authUser });
}

module.exports = {
    buildLabTestReportForDelivery,
};
