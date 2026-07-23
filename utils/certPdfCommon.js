const { queryOne } = require('../db');
const { resolveAdminContext } = require('./adminContext');
const { resolveUploadedFilePath } = require('./uploadedFiles');
const { PREFIX } = require('./gcs');

const CHECKBOX_SIZE = 12;

const LAB_SELECT = `SELECT company_name, logo_file, report_header_file, address, public_phone_no, public_fax,
                public_email, tagline, email, medical_officer_name, mrocc, clia_number,
                medical_officer_signature_file_name
         FROM b2b_clients
         WHERE id = $1 AND deleted = false
         LIMIT 1`;

function textOrNull(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
    return text;
}

function labText(labValue) {
    return textOrNull(labValue) || '';
}

/** Only the lab's uploaded logo — no Metro Lab default (same as health/physical certs). */
async function resolveCertLogoPath(lab) {
    return resolveUploadedFilePath(lab?.logo_file, { prefix: PREFIX.b2bClients });
}

/**
 * Header banner: logo left, lab details right, double blue rule (certs + lab reports).
 */
function drawCertBannerHeader(doc, { left, right, y, logoPath, hasLabLogo, company, address, phone, fax, email }) {
    const logoW = 88;
    const logoH = 64;
    const startY = y;

    let infoX = left;

    if (hasLabLogo && logoPath) {
        try {
            doc.image(logoPath, left, y, { fit: [logoW, logoH] });
            infoX = left + logoW + 20; // 20px gap between logo and text
        } catch (err) {
            console.warn('Could not embed lab logo:', err.message);
        }
    }

    const infoW = right - infoX;
    let infoY = y + (hasLabLogo ? 4 : 0);

    if (company) {
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#111')
            .text(company, infoX, infoY, { width: infoW, align: 'left' });
        infoY += 26;
    }
    
    doc.font('Helvetica').fontSize(10.5).fillColor('#111');
    if (address) {
        doc.text(address, infoX, infoY, { width: infoW, align: 'left' });
        infoY += 14;
    }
    
    const contactLine = [
        phone ? `Phone: ${phone}` : '',
        fax ? `Fax: ${fax}` : '',
        email ? email : '',
    ].filter(Boolean).join(' • ');
    
    if (contactLine) {
        doc.text(contactLine, infoX, infoY, { width: infoW, align: 'left' });
        infoY += 14;
    }

    const blockH = Math.max(hasLabLogo ? logoH : 0, infoY - startY);
    let hy = startY + blockH + 12;

    doc.moveTo(left, hy).lineTo(right, hy).strokeColor('#60a5fa').lineWidth(3).stroke();
    return hy + 18;
}

/** Vector checkmark stroke — no font glyphs (avoids & / * rendering issues). */
function strokeCheckmark(doc, x, y, size) {
    doc.lineWidth(1.5).lineCap('round').lineJoin('round').strokeColor('#111');
    doc.moveTo(x + size * 0.18, y + size * 0.52)
        .lineTo(x + size * 0.4, y + size * 0.76)
        .lineTo(x + size * 0.84, y + size * 0.2)
        .stroke();
}

/** Square checkbox with vector checkmark centered inside. */
function drawCheckbox(doc, x, y, checked, size = CHECKBOX_SIZE) {
    doc.save();
    doc.lineWidth(1.2).strokeColor('#111');
    doc.rect(x, y, size, size).stroke();
    if (checked) {
        strokeCheckmark(doc, x, y, size);
    }
    doc.restore();
}

/** Checkmark in table cells (Normal / Abnormal columns). */
function drawCheckMark(doc, x, y, size = CHECKBOX_SIZE) {
    doc.save();
    strokeCheckmark(doc, x, y, size);
    doc.restore();
}

function drawUnderlineField(doc, x, y, width, value, fontSize = 10.5, lineOffset = 14) {
    const text = value ? String(value) : '';
    doc.moveTo(x, y + lineOffset).lineTo(x + width, y + lineOffset).strokeColor('#111').lineWidth(0.8).stroke();
    if (text) {
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#111')
            .text(text, x + 2, y + 1, { width: width - 4, align: 'center', lineBreak: false });
    }
}

/**
 * Lab branding for certificate PDFs (download, email, preview parity).
 * 1. Logged-in B2B portal user
 * 2. Admin context (B2B or corporate → parent B2B)
 * 3. Patient's linked B2B client (fallback)
 */
async function resolveCertLabBranding(authUser, patientB2bClientId) {
    if (authUser?.portal === 'b2b' && authUser.id) {
        const lab = await queryOne(LAB_SELECT, [authUser.id]);
        if (lab) return lab;
    }

    if (authUser?.id) {
        const ctx = await resolveAdminContext(authUser.id);
        if (ctx.b2b_client_id) {
            const lab = await queryOne(LAB_SELECT, [ctx.b2b_client_id]);
            if (lab) return lab;
        }
    }

    if (patientB2bClientId) {
        const lab = await queryOne(LAB_SELECT, [patientB2bClientId]);
        if (lab) return lab;
    }

    return null;
}

/**
 * Draw cert-style banner (logo left, lab details right, double blue rule).
 * @returns {Promise<number>} Y position below the banner
 */
async function drawLabPdfBanner(doc, lab, { left, right, y = 32 } = {}) {
    const logoPath = await resolveCertLogoPath(lab);
    return drawCertBannerHeader(doc, {
        left,
        right,
        y,
        logoPath,
        hasLabLogo: Boolean(logoPath),
        company: labText(lab?.company_name),
        address: labText(lab?.address),
        phone: labText(lab?.public_phone_no),
        fax: labText(lab?.public_fax),
        email: labText(lab?.public_email) || labText(lab?.email),
    });
}

module.exports = {
    resolveCertLabBranding,
    resolveCertLogoPath,
    drawCertBannerHeader,
    drawLabPdfBanner,
    labText,
    drawCheckbox,
    drawCheckMark,
    drawUnderlineField,
    CHECKBOX_SIZE,
    LAB_SELECT,
};
