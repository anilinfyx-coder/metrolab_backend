const fs = require('fs');
const path = require('path');

const LOGO_CID = 'email-brand-logo';
const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'metrolab-logo.png');
const FRONTEND_LOGO_PATH = path.join(__dirname, '..', '..', 'metrolab_frontend', 'public', 'login-logo.png');

const B2B_BRANDING_SELECT = `
    company_name, tagline, logo_file, report_header_file, email, public_email
`;

function resolveUploadedImagePath(filename) {
    if (!filename) return null;
    const clean = String(filename).trim();
    const normalized = clean.replace(/\\/g, '/');
    const baseName = path.basename(normalized);
    const bases = [
        path.join(__dirname, '..'),
        path.join(__dirname, '..', 'uploads', 'b2bClients'),
        path.join(__dirname, '..', 'Uploads', 'b2bClients'),
    ];

    const candidates = [
        clean,
        normalized,
        baseName,
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

function normalizeText(value, fallback = '') {
    if (value == null) return fallback;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') {
        return fallback;
    }
    return text;
}

function resolveLabLogoPath(lab) {
    const uploadedLogo =
        resolveUploadedImagePath(lab?.logo_file) ||
        resolveUploadedImagePath(lab?.report_header_file);
    if (uploadedLogo && !uploadedLogo.toLowerCase().endsWith('.webp')) {
        return uploadedLogo;
    }
    if (fs.existsSync(DEFAULT_LOGO_PATH)) return DEFAULT_LOGO_PATH;
    if (fs.existsSync(FRONTEND_LOGO_PATH)) return FRONTEND_LOGO_PATH;
    return null;
}

function buildEmailBranding(lab) {
    const companyName = normalizeText(lab?.company_name, 'Metrolab') || 'Metrolab';
    const tagline = normalizeText(lab?.tagline);
    const logoPath = resolveLabLogoPath(lab);

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
    resolveUploadedImagePath,
};
