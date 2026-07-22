const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { queryOne } = require('../db');
const { resolveCertLabBranding, resolveCertLogoPath, drawCertBannerHeader, drawCheckbox, drawUnderlineField, labText, CHECKBOX_SIZE } = require('./certPdfCommon');

function pad(n) {
    return String(n).padStart(2, '0');
}

function formatUsDate(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const [y, m, day] = value.slice(0, 10).split('-').map(Number);
        return `${m}/${day}/${y}`;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function buildBirthdatePassword(dob) {
    if (!dob) return null;
    let m; let day;
    if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dob)) {
        const parts = dob.slice(0, 10).split('-');
        m = Number(parts[1]);
        day = Number(parts[2]);
    } else {
        const d = new Date(dob);
        if (Number.isNaN(d.getTime())) return null;
        m = d.getMonth() + 1;
        day = d.getDate();
    }
    if (!m || !day) return null;
    return `${pad(m)}${pad(day)}`;
}

function encryptPdfBuffer(plainBuffer, userPassword) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrolab-pdf-'));
    const inPath = path.join(tmpDir, 'plain.pdf');
    const outPath = path.join(tmpDir, 'encrypted.pdf');
    try {
        fs.writeFileSync(inPath, plainBuffer);
        muhammara.recrypt(inPath, outPath, {
            userPassword: String(userPassword),
            ownerPassword: String(userPassword),
            userProtectionFlag: 4,
        });
        return fs.readFileSync(outPath);
    } finally {
        try { fs.unlinkSync(inPath); } catch (_) { }
        try { fs.unlinkSync(outPath); } catch (_) { }
        try { fs.rmdirSync(tmpDir); } catch (_) { }
    }
}

async function resolveLoggedInLab(authUser, patientB2bClientId) {
    return resolveCertLabBranding(authUser, patientB2bClientId);
}

function textOrNull(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
    return text;
}

/** Prefer logged-in lab field; otherwise Metro Lab fallback. */
function labOrFallback(labValue, fallback) {
    return textOrNull(labValue) || fallback;
}

/**
 * Resolve branding for the signed-in lab.
 * Used by download AND email so both PDFs match the preview.
 * Admin staff → b2b via admin_users.user_id; B2B portal → client id.
 * Falls back to Metro Lab when no lab row is found.
 */
async function resolveLoggedInLab(authUser) {
    if (!authUser || !authUser.id) return null;

    let b2bId = null;

    if (authUser.portal === 'b2b') {
        b2bId = authUser.id;
    } else {
        // admin portal, or older tokens without portal — try admin_users first
        const admin = await queryOne(
            'SELECT user_id FROM admin_users WHERE id = $1 AND deleted = false LIMIT 1',
            [authUser.id]
        );
        if (admin?.user_id) {
            b2bId = admin.user_id;
        } else if (authUser.portal !== 'admin') {
            // last resort: treat id as b2b client id
            const asClient = await queryOne(
                'SELECT id FROM b2b_clients WHERE id = $1 AND deleted = false LIMIT 1',
                [authUser.id]
            );
            if (asClient) b2bId = authUser.id;
        }
    }

    if (!b2bId) return null;

    return queryOne(
        `SELECT company_name, logo_file, report_header_file, address, public_phone_no, public_fax,
                public_email, website, medical_officer_signature_file_name, tagline,
                smtp_server, smtp_port, smtp_email, smtp_password
         FROM b2b_clients
         WHERE id = $1 AND deleted = false
         LIMIT 1`,
        [b2bId]
    );
}

async function resolveCertLogoPath(lab) {
    const labLogo = await resolveUploadedFilePath(lab?.logo_file, { prefix: PREFIX.b2bClients });
    if (labLogo) return labLogo;
    return resolveLabLogoPath(lab);
}

function isMale(sex) {
    return sex === 1 || sex === '1' || String(sex || '').toLowerCase() === 'male';
}

function isFemale(sex) {
    return sex === 2 || sex === '2' || String(sex || '').toLowerCase() === 'female';
}

function drawDigitalAuthBlock(doc, { left, pageW, y, clinicianName, specialty, examDate, clinicianAddress }) {
    const headerH = 26;
    const bodyH = 66;
    const noteH = 28;
    const boxH = headerH + bodyH + noteH;

    doc.roundedRect(left, y, pageW, boxH, 3)
        .lineWidth(1.2).strokeColor('#1e40af').stroke();

    doc.rect(left, y, pageW, headerH).fill('#eff6ff');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e40af')
        .text('ELECTRONICALLY AUTHENTICATED CERTIFICATE', left, y + 8, { width: pageW, align: 'center' });

    const innerY = y + headerH + 14;
    const colW = pageW / 2;

    doc.font('Helvetica').fontSize(7.5).fillColor('#555')
        .text('Digitally Signed By', left + 14, innerY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text(clinicianName ? String(clinicianName) : '-', left + 14, innerY + 12, { width: colW - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#333')
        .text(specialty ? String(specialty) : 'MD / PA / NP', left + 14, innerY + 28);

    doc.font('Helvetica').fontSize(7.5).fillColor('#555')
        .text('Date of Examination', left + colW + 14, innerY);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text(formatUsDate(examDate) || '-', left + colW + 14, innerY + 12);

    doc.font('Helvetica').fontSize(7.5).fillColor('#555')
        .text('Clinician Address', left + colW + 14, innerY + 28);
    doc.font('Helvetica').fontSize(8.5).fillColor('#111')
        .text(clinicianAddress ? String(clinicianAddress) : '-', left + colW + 14, innerY + 40, {
            width: colW - 20,
            lineBreak: false,
            ellipsis: true,
        });

    const noteY = y + headerH + bodyH;
    doc.moveTo(left, noteY).lineTo(left + pageW, noteY)
        .strokeColor('#dbeafe').lineWidth(0.6).stroke();
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#666')
        .text('This document is electronically authenticated. No physical signature is required.', left, noteY + 9, {
            width: pageW,
            align: 'center',
        });

    return y + boxH + 8;
}

async function buildAdultHealthCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT 
            ahc.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel, p.street1, p.street2,
            p.city, p.state, p.zipcode, p.email as patient_email, p.b2b_client_id
        FROM adult_health_certificates ahc
        LEFT JOIN patient p ON ahc.patient_id = p.id
        WHERE ahc.id = $1 AND ahc.deleted = false`,
        [id]
    );

    if (!cert) throw new Error('Certificate not found');

    // Logged-in lab branding (admin staff → b2b via user_id, or b2b portal).
    const lab = await resolveLoggedInLab(options.authUser, cert.b2b_client_id);
    const logoPath = await resolveCertLogoPath(lab);
    const hasLabLogo = Boolean(logoPath);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                if (options.encrypt) {
                    const password = buildBirthdatePassword(cert.patient_dob);
                    if (!password) {
                        return reject(new Error('Cannot encrypt: patient DOB is invalid'));
                    }
                    const encryptedBuffer = encryptPdfBuffer(pdfBuffer, password);
                    resolve({
                        buffer: encryptedBuffer,
                        cert,
                        filename: `Adult_Health_Certificate_${cert.id}.pdf`,
                        password,
                        lab,
                    });
                } else {
                    resolve({ buffer: pdfBuffer, cert, filename: `Adult_Health_Certificate_${cert.id}.pdf`, lab });
                }
            });

            // Layout matches the on-screen preview (same structure for download + email)
            const left = 44;
            const right = doc.page.width - 44;
            const pageW = right - left;
            let y = 32;

            const company = labText(lab?.company_name);
            const address = labText(lab?.address);
            const phone = labText(lab?.public_phone_no);
            const fax = labText(lab?.public_fax);
            const email = labText(lab?.public_email);
            const watermarkText = company || '';

            // Watermark (lab name only — never Metro Lab default)
            if (watermarkText) {
                doc.save();
                doc.fillColor('#94a3b8', 0.08);
                doc.font('Helvetica-Bold').fontSize(48);
                doc.rotate(-28, { origin: [doc.page.width / 2, doc.page.height / 2] });
                doc.text(watermarkText, 60, doc.page.height / 2 - 18, { align: 'center', width: pageW + 80 });
                doc.restore();
                doc.fillColor('#111').opacity(1);
            }

            y = drawCertBannerHeader(doc, {
                left,
                right,
                y,
                logoPath,
                hasLabLogo,
                company,
                address,
                phone,
                fax,
                email,
            });

            // Title
            doc.font('Times-Bold').fontSize(20).text('Adult Health Certificate', left, y, { align: 'center', width: pageW });
            y += 32;

            const rowH = 28;
            const checkGap = 6;
            const listLeft = left + 8;
            const textX = listLeft + 40;

            // Patient: Name + Sex
            const sexLabelX = left + 272;
            doc.font('Times-Roman').fontSize(11);
            doc.text('Name:', left, y + 2);
            drawUnderlineField(doc, left + 42, y, sexLabelX - left - 52, cert.patient_name);
            doc.text('Sex:', sexLabelX, y + 2);
            let sx = sexLabelX + 30;
            drawCheckbox(doc, sx, y + 1, isMale(cert.sex));
            doc.text('Male', sx + CHECKBOX_SIZE + checkGap, y + 2);
            sx += CHECKBOX_SIZE + checkGap + 36;
            drawCheckbox(doc, sx, y + 1, isFemale(cert.sex));
            doc.text('Female', sx + CHECKBOX_SIZE + checkGap, y + 2);
            y += rowH;

            // DOB / Tel
            doc.font('Times-Roman').fontSize(11).text('DOB:', left, y + 2);
            drawUnderlineField(doc, left + 36, y, 148, formatUsDate(cert.patient_dob));
            doc.font('Times-Roman').fontSize(11).text('Tel #:', left + 198, y + 2);
            drawUnderlineField(doc, left + 238, y, pageW - 194, cert.tel);
            y += rowH;

            // Address with guides
            doc.font('Times-Roman').fontSize(11).text('Address:', left, y + 2);
            const colGap = 8;
            const streetW = 138;
            const aptW = 86;
            const cityW = 86;
            const stateW = 52;
            const zipW = 66;
            let ax = left + 56;
            drawUnderlineField(doc, ax, y, streetW, cert.street1); ax += streetW + colGap;
            drawUnderlineField(doc, ax, y, aptW, cert.street2); ax += aptW + colGap;
            drawUnderlineField(doc, ax, y, cityW, cert.city); ax += cityW + colGap;
            drawUnderlineField(doc, ax, y, stateW, cert.state); ax += stateW + colGap;
            drawUnderlineField(doc, ax, y, zipW, cert.zipcode);
            y += 18;
            doc.font('Times-Roman').fontSize(8).fillColor('#555');
            ax = left + 56;
            doc.text('Street Name/Number', ax, y, { width: streetW, align: 'center' }); ax += streetW + colGap;
            doc.text('Apt#(if applicable)', ax, y, { width: aptW, align: 'center' }); ax += aptW + colGap;
            doc.text('City', ax, y, { width: cityW, align: 'center' }); ax += cityW + colGap;
            doc.text('State', ax, y, { width: stateW, align: 'center' }); ax += stateW + colGap;
            doc.text('Zip code', ax, y, { width: zipW, align: 'center' });
            y += 24;

            // Certify
            doc.fillColor('#111').font('Times-Roman').fontSize(11)
                .text('I have examined the above named person and certify that he/she is:', left, y);
            y += 22;

            doc.font('Times-Roman').fontSize(11).text('1.', listLeft, y + 2);
            drawCheckbox(doc, listLeft + 20, y + 1, !!cert.free_from_disease);
            doc.text('Free from disease in communicable form.', textX, y + 2);
            y += 22;

            const item2Text = 'In satisfactory physical condition, this will permit, close association with children/elderly without danger to them.';
            doc.font('Times-Roman').fontSize(11).text('2.', listLeft, y + 2);
            drawCheckbox(doc, listLeft + 20, y + 1, !!cert.satisfactory_physical);
            const item2W = pageW - textX;
            doc.text(item2Text, textX, y + 2, { width: item2W, lineGap: 3 });
            y += doc.heightOfString(item2Text, { width: item2W }) + 14;

            doc.font('Times-Roman').fontSize(11)
                .text('In addition to a general physical examination, the following test has been done:', left, y);
            y += 22;

            // Tuberculin
            doc.font('Times-Roman').fontSize(11).text('Tuberculin test (check one):', left, y + 2);
            let tx = left + 172;
            drawCheckbox(doc, tx, y + 1, cert.tuberculin_test_type === 'Tine');
            doc.text('Tine', tx + CHECKBOX_SIZE + checkGap, y + 2);
            tx += CHECKBOX_SIZE + checkGap + 42;
            drawCheckbox(doc, tx, y + 1, cert.tuberculin_test_type === 'PPD');
            doc.text('PPD', tx + CHECKBOX_SIZE + checkGap, y + 2);
            y += rowH;

            doc.font('Times-Roman').fontSize(11).text('Date planted:', left, y + 2);
            drawUnderlineField(doc, left + 78, y, 88, formatUsDate(cert.tuberculin_date_planted));
            doc.font('Times-Roman').fontSize(11).text('Date read:', left + 180, y + 2);
            drawUnderlineField(doc, left + 244, y, 88, formatUsDate(cert.tuberculin_date_read));
            doc.font('Times-Roman').fontSize(11).text('Result:', left + 346, y + 2);
            drawUnderlineField(doc, left + 388, y, pageW - 344, cert.tuberculin_result);
            y += rowH;

            // Chest x-ray
            const hasXray = !!(cert.chest_xray_date || cert.chest_xray_result);
            drawCheckbox(doc, left, y + 1, hasXray);
            doc.font('Times-Roman').fontSize(11).text('Chest x-ray:', left + CHECKBOX_SIZE + checkGap, y + 2);
            doc.text('Date:', left + 108, y + 2);
            drawUnderlineField(doc, left + 142, y, 92, formatUsDate(cert.chest_xray_date));
            doc.font('Times-Roman').fontSize(11).text('Result:', left + 248, y + 2);
            drawUnderlineField(doc, left + 292, y, pageW - 248, cert.chest_xray_result);
            y += rowH;

            // Additional info
            drawCheckbox(doc, left, y + 1, !!cert.additional_info);
            doc.font('Times-Roman').fontSize(11)
                .text('Additional information, Past Medical History, Current Medications:', left + CHECKBOX_SIZE + checkGap, y + 2, {
                    width: pageW - CHECKBOX_SIZE - checkGap,
                });
            y += 24;
            doc.moveTo(left + 22, y + 16).lineTo(right, y + 16).strokeColor('#111').lineWidth(0.8).stroke();
            if (cert.additional_info) {
                doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111')
                    .text(String(cert.additional_info), left + 26, y + 2, {
                        width: pageW - 32,
                        height: 16,
                        lineBreak: false,
                    });
            }
            y += 32;
            doc.moveTo(left + 22, y + 16).lineTo(right, y + 16).strokeColor('#111').lineWidth(0.8).stroke();
            y += 38;

            drawDigitalAuthBlock(doc, {
                left,
                pageW,
                y,
                clinicianName: cert.clinician_name,
                specialty: cert.clinician_specialty,
                examDate: cert.date_of_examination,
                clinicianAddress: cert.clinician_address,
            });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    buildAdultHealthCertPdf,
};
