const path = require('path');
const { resolveCertLogoPath, labText } = require('./certPdfCommon');
const { resolveDefaultLogoPath } = require('./uploadedFiles');

const LOGO_CID = 'email-brand-logo';
const METRO_LAB_NAME = process.env.SMTP_FROM_NAME || 'Metro Lab';

const B2B_BRANDING_SELECT = `
    company_name, tagline, logo_file, report_header_file, address, public_phone_no, public_fax,
    email, public_email,
    smtp_server, smtp_port, smtp_email, smtp_password
`;

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildContactLines(lab) {
    const lines = [];
    const address = labText(lab?.address);
    const phone = labText(lab?.public_phone_no);
    const fax = labText(lab?.public_fax);
    const email = labText(lab?.public_email) || labText(lab?.email);

    if (address) lines.push(escapeHtml(address));
    const tellParts = [
        phone ? `(Tell) ${escapeHtml(phone)}` : '',
        fax ? `(Fax) ${escapeHtml(fax)}` : '',
    ].filter(Boolean);
    if (tellParts.length) lines.push(tellParts.join(' '));
    if (email) lines.push(escapeHtml(email));
    return lines;
}

/** Marker lab object — Super Admin emails use Metro Lab default branding. */
function metroLabEmailLab() {
    return {
        useMetroLabDefault: true,
        company_name: METRO_LAB_NAME,
    };
}

/**
 * Pick email branding for the sender portal.
 * Super Admin → Metro Lab default logo; otherwise use the given lab.
 */
function resolveEmailLabForPortal(authUser, lab = null) {
    if (authUser?.portal === 'superadmin') {
        return metroLabEmailLab();
    }
    return lab;
}

/**
 * Email header branding.
 * - Lab/B2B: uploaded logo_file only (no default)
 * - Super Admin / useMetroLabDefault: Metro Lab default logo
 */
async function buildEmailBranding(lab) {
    const useMetroDefault = lab?.useMetroLabDefault === true;
    const companyName = useMetroDefault
        ? METRO_LAB_NAME
        : labText(lab?.company_name);
    const tagline = useMetroDefault ? '' : labText(lab?.tagline);

    let logoPath = null;
    if (useMetroDefault) {
        logoPath = await resolveDefaultLogoPath();
    } else if (lab) {
        logoPath = await resolveCertLogoPath(lab);
    }

    const contactLines = useMetroDefault ? [] : buildContactLines(lab);

    let logoAttachment = null;
    let logoCell = '';

    if (logoPath) {
        logoAttachment = {
            filename: path.basename(logoPath),
            path: logoPath,
            cid: LOGO_CID,
        };
        logoCell = `
            <td valign="top" width="120" style="padding-right: 16px;">
                <img src="cid:${LOGO_CID}" alt="${escapeHtml(companyName || 'Lab')} Logo"
                     style="display: block; max-width: 110px; max-height: 72px; width: auto; height: auto; object-fit: contain;" />
            </td>`;
    }

    const companyBlock = companyName
        ? `<div style="font-family: 'Times New Roman', Georgia, serif; font-size: 17px; font-weight: 700; color: #111111; line-height: 1.3; margin-bottom: 4px;">${escapeHtml(companyName)}</div>`
        : '';
    const taglineBlock = tagline
        ? `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748b; font-style: italic; margin-bottom: 6px;">${escapeHtml(tagline)}</div>`
        : '';
    const contactBlock = contactLines.length
        ? contactLines.map((line) => `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #334155; line-height: 1.45; margin-bottom: 2px;">${line}</div>`).join('')
        : '';

    // Super Admin: logo centered when no contact block
    let headerHtml;
    if (useMetroDefault && logoCell) {
        headerHtml = `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td align="center" style="padding-bottom: 4px;">
                        <img src="cid:${LOGO_CID}" alt="${escapeHtml(companyName)} Logo"
                             style="display: block; margin: 0 auto; max-width: 180px; max-height: 80px; width: auto; height: auto; object-fit: contain;" />
                        <div style="font-family: 'Times New Roman', Georgia, serif; font-size: 17px; font-weight: 700; color: #111111; margin-top: 10px;">
                            ${escapeHtml(companyName)}
                        </div>
                    </td>
                </tr>
            </table>`;
    } else if (logoCell || companyBlock || contactBlock) {
        headerHtml = `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    ${logoCell}
                    <td valign="top" align="right" style="font-family: Arial, Helvetica, sans-serif;">
                        ${companyBlock}
                        ${taglineBlock}
                        ${contactBlock}
                    </td>
                </tr>
            </table>`;
    } else {
        headerHtml = '<div style="margin-bottom: 4px;"></div>';
    }

    return {
        headerHtml,
        logoAttachment,
        companyName: companyName || 'Lab',
        tagline,
        signatureHtml: companyName
            ? `<p style="margin: 0; font-weight: 700; color: #0f172a;">The ${escapeHtml(companyName)} Team</p>`
            : '<p style="margin: 0; font-weight: 700; color: #0f172a;">Best Regards</p>',
    };
}

module.exports = {
    B2B_BRANDING_SELECT,
    buildEmailBranding,
    metroLabEmailLab,
    resolveEmailLabForPortal,
    METRO_LAB_NAME,
};
