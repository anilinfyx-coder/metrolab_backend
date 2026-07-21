const path = require('path');
const { resolveLabLogoPath, resolveUploadedFilePath } = require('./uploadedFiles');
const { PREFIX } = require('./gcs');

const LOGO_CID = 'email-brand-logo';

const B2B_BRANDING_SELECT = `
    company_name, tagline, logo_file, report_header_file, email, public_email
`;

function normalizeText(value, fallback = '') {
    if (value == null) return fallback;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') {
        return fallback;
    }
    return text;
}

async function buildEmailBranding(lab) {
    const companyName = normalizeText(lab?.company_name, 'Metrolab') || 'Metrolab';
    const tagline = normalizeText(lab?.tagline);
    const logoPath = await resolveLabLogoPath(lab);

    let logoAttachment = null;
    let headerHtml;

    if (logoPath) {
        logoAttachment = {
            filename: path.basename(logoPath),
            path: logoPath,
            cid: LOGO_CID,
        };
        const taglineHtml = tagline
            ? `<p style="margin: 8px 0 0 0; font-size: 13px; color: #666; font-style: italic;">${tagline}</p>`
            : '';
        headerHtml = [
            '<div style="text-align: center; margin-bottom: 20px;">',
            `        <img src="cid:${LOGO_CID}" alt="${companyName} Logo" style="max-width: 220px; max-height: 90px; height: auto; object-fit: contain;" />`,
            taglineHtml,
            '</div>',
        ].join('\n    ');
    } else {
        const taglineHtml = tagline
            ? `<p style="margin: 8px 0 0 0; font-size: 13px; color: #666;">${tagline}</p>`
            : '';
        headerHtml = [
            '<div style="text-align: center; margin-bottom: 20px;">',
            `        <strong style="font-size: 24px; color: #0076A3;">${companyName}</strong>`,
            taglineHtml,
            '</div>',
        ].join('\n    ');
    }

    return {
        headerHtml,
        logoAttachment,
        companyName,
        tagline,
        signatureHtml: `<p><strong>The ${companyName} Team</strong></p>`,
    };
}

module.exports = {
    B2B_BRANDING_SELECT,
    buildEmailBranding,
    resolveLabLogoPath,
    resolveUploadedFilePath,
    PREFIX,
};
