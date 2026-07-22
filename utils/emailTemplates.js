const { buildEmailBranding } = require('./emailBranding');

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildPrimaryButton(label, href) {
    return `
        <table cellpadding="0" cellspacing="0" border="0" style="margin: 28px auto;">
            <tr>
                <td align="center" style="border-radius: 6px; background-color: #0f766e;">
                    <a href="${href}" target="_blank" rel="noopener noreferrer"
                       style="display: inline-block; padding: 14px 32px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 6px;">
                        ${escapeHtml(label)}
                    </a>
                </td>
            </tr>
        </table>`;
}

/**
 * Key-value detail block for emails.
 * @param {{ label: string, value: string }[]} rows
 */
function buildInfoBox(rows) {
    if (!rows || !rows.length) return '';
    const inner = rows
        .filter((r) => r.value != null && r.value !== '')
        .map((row, i) => `
            <tr>
                <td style="padding: 14px 18px;${i > 0 ? ' border-top: 1px solid #e2e8f0;' : ''}">
                    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                        ${escapeHtml(row.label)}
                    </div>
                    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 600; color: #0f172a; line-height: 1.4;">
                        ${escapeHtml(row.value)}
                    </div>
                </td>
            </tr>`)
        .join('');
    if (!inner) return '';
    return `
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin: 24px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            ${inner}
        </table>`;
}

function buildAlertBox(message, { title = 'Note', variant = 'warning' } = {}) {
    const styles = variant === 'danger'
        ? { bg: '#fef2f2', border: '#fecaca', title: '#991b1b', text: '#7f1d1d' }
        : { bg: '#fffbeb', border: '#fde68a', title: '#92400e', text: '#78350f' };
    return `
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin: 24px 0; background-color: ${styles.bg}; border: 1px solid ${styles.border}; border-radius: 8px;">
            <tr>
                <td style="padding: 16px 18px; font-family: Arial, Helvetica, sans-serif;">
                    <div style="font-size: 13px; font-weight: 700; color: ${styles.title}; margin-bottom: 6px;">${escapeHtml(title)}</div>
                    <div style="font-size: 13px; color: ${styles.text}; line-height: 1.55;">${message}</div>
                </td>
            </tr>
        </table>`;
}

function buildParagraph(text) {
    return `<p style="margin: 0 0 16px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.65; color: #334155;">${text}</p>`;
}

function buildGreeting(name) {
    return buildParagraph(`Dear <strong>${escapeHtml(name || 'User')}</strong>,`);
}

/**
 * Full HTML document wrapper — table layout for email client compatibility.
 */
function buildEmailDocument({ branding, title, titleColor = '#0f172a', bodyHtml }) {
    const company = escapeHtml(branding.companyName || 'Lab');
    const headerBlock = branding.headerHtml || '';
    const signature = branding.signatureHtml || '<p style="margin:24px 0 0;font-weight:700;color:#0f172a;">Best Regards</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #e8eef5; -webkit-text-size-adjust: 100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #e8eef5; padding: 32px 12px;">
        <tr>
            <td align="center">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
                       style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 28px rgba(15, 23, 42, 0.1);">
                    <tr>
                        <td style="padding: 28px 36px 12px; font-family: Arial, Helvetica, sans-serif;">
                            ${headerBlock}
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 16px;">
                                <tr><td style="border-top: 2px solid #6c9cd4; font-size: 0; line-height: 0;">&nbsp;</td></tr>
                                <tr><td style="border-top: 1px solid #6c9cd4; font-size: 0; line-height: 0; padding-top: 3px;">&nbsp;</td></tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 20px 36px 8px; font-family: 'Times New Roman', Georgia, serif;">
                            <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: ${titleColor}; line-height: 1.3;">
                                ${escapeHtml(title)}
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 36px 32px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.65; color: #334155;">
                            ${bodyHtml}
                            <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #0f172a;">
                                ${signature}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 16px 36px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.5; color: #64748b;">
                            This is an automated message from ${company}. Please do not reply directly to this email.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

async function buildBrandedEmail({ lab, title, titleColor, bodyHtml }) {
    const branding = await buildEmailBranding(lab);
    const html = buildEmailDocument({ branding, title, titleColor, bodyHtml });
    return { html, branding };
}

module.exports = {
    escapeHtml,
    buildPrimaryButton,
    buildInfoBox,
    buildAlertBox,
    buildParagraph,
    buildGreeting,
    buildEmailDocument,
    buildBrandedEmail,
};
