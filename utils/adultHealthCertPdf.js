const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { queryOne } = require('../db');
const { resolveCertLabBranding, resolveCertLogoPath, resolveCertSignaturePath, drawCertBannerHeader, drawCheckbox, drawUnderlineField, labText, CHECKBOX_SIZE } = require('./certPdfCommon');
const { decryptPIIFields } = require('./cryptoUtils');

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

async function resolveLoggedInLab(authUser, patientB2bClientId, labTestId = null) {
    return resolveCertLabBranding(authUser, patientB2bClientId, labTestId);
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





function isMale(sex) {
    return sex === 1 || sex === '1' || String(sex || '').toLowerCase() === 'male';
}

function isFemale(sex) {
    return sex === 2 || sex === '2' || String(sex || '').toLowerCase() === 'female';
}

function drawDigitalAuthBlock(doc, { left, pageW, y, clinicianName, specialty, examDate, clinicianAddress, mroName, mrocc, cliaNumber, sigPath }) {
    doc.save();
    const rowH = 22;

    let currentY = y;
    
    // 1. Clinician Block (as before)
    doc.font('Times-Roman').fontSize(10.5).fillColor('#111');
    doc.text('Name/Signature of examining Clinician:', left, currentY + 2, { lineBreak: false });
    const label1W = doc.widthOfString('Name/Signature of examining Clinician:') + 6;
    const nameLineW = 180;
    const nameX = left + label1W;
    
    doc.moveTo(nameX, currentY + 13).lineTo(nameX + nameLineW, currentY + 13).strokeColor('#111').lineWidth(0.8).stroke();
    if (clinicianName) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111');
        doc.text(String(clinicianName), nameX, currentY + 1, { width: nameLineW, align: 'center', lineBreak: false });
    }
    
    const specX = nameX + nameLineW + 8;
    doc.font('Times-Roman').fontSize(10.5).fillColor('#111');
    doc.text(specialty ? String(specialty) : 'MD/PA/NP', specX, currentY + 2, { lineBreak: false });
    currentY += rowH;

    doc.font('Times-Roman').fontSize(10.5).fillColor('#111');
    doc.text('Date of examination:', left, currentY + 2, { lineBreak: false });
    const label2W = doc.widthOfString('Date of examination:') + 6;
    const dateLineW = 120;
    const dateX = left + label2W;
    
    doc.moveTo(dateX, currentY + 13).lineTo(dateX + dateLineW, currentY + 13).strokeColor('#111').lineWidth(0.8).stroke();
    if (examDate) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111');
        doc.text(formatUsDate(examDate), dateX, currentY + 1, { width: dateLineW, align: 'center', lineBreak: false });
    }
    
    const addrLabelX = dateX + dateLineW + 12;
    doc.font('Times-Roman').fontSize(10.5).fillColor('#111');
    doc.text('Address:', addrLabelX, currentY + 2, { lineBreak: false });
    const addrLabelW = doc.widthOfString('Address:') + 6;
    const addrLineW = left + pageW - (addrLabelX + addrLabelW);
    const addrX = addrLabelX + addrLabelW;
    
    doc.moveTo(addrX, currentY + 13).lineTo(addrX + addrLineW, currentY + 13).strokeColor('#111').lineWidth(0.8).stroke();
    if (clinicianAddress) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111');
        doc.text(String(clinicianAddress), addrX, currentY + 1, { width: addrLineW, align: 'center', lineBreak: false, ellipsis: true });
    }
    currentY += rowH + 4;

    // Divider line between Clinician and MRO
    doc.moveTo(left, currentY).lineTo(left + pageW, currentY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    currentY += 6;

    // 2. Medical Review Officer Section (2 Lines)
    // Line 1: Medical Officer Name & Signature Image
    doc.font('Times-Bold').fontSize(10.5).fillColor('#111');
    doc.text('Medical Review Officer:', left, currentY + 2, { lineBreak: false });
    const mroLabelW = doc.widthOfString('Medical Review Officer:') + 6;
    const mroNameX = left + mroLabelW;
    const mroNameLineW = 160;
    
    doc.moveTo(mroNameX, currentY + 13).lineTo(mroNameX + mroNameLineW, currentY + 13).strokeColor('#111').lineWidth(0.8).stroke();
    if (mroName) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111');
        doc.text(String(mroName), mroNameX, currentY + 1, { width: mroNameLineW, align: 'center', lineBreak: false });
    }

    const sigLabelX = mroNameX + mroNameLineW + 16;
    doc.font('Times-Bold').fontSize(10.5).fillColor('#111');
    doc.text('Signature:', sigLabelX, currentY + 2, { lineBreak: false });
    const sigLabelW = doc.widthOfString('Signature:') + 6;
    const sigLineX = sigLabelX + sigLabelW;
    const sigLineW = left + pageW - sigLineX;

    doc.moveTo(sigLineX, currentY + 13).lineTo(sigLineX + sigLineW, currentY + 13).strokeColor('#111').lineWidth(0.8).stroke();
    if (sigPath && !sigPath.toLowerCase().endsWith('.webp')) {
        try {
            doc.image(sigPath, sigLineX + (sigLineW - 90) / 2, currentY - 14, { fit: [90, 24] });
        } catch (err) {
            console.warn('Could not embed signature in adult health cert:', err.message);
        }
    }
    currentY += rowH;

    // Line 2: MROCC & CLIA No.
    doc.font('Times-Roman').fontSize(10).fillColor('#333');
    const mroccText = mrocc ? `MROCC: ${mrocc}` : '';
    const cliaText = cliaNumber ? `CLIA No.: ${cliaNumber}` : '';
    const mroSubDetails = [mroccText, cliaText].filter(Boolean).join('   |   ');
    if (mroSubDetails) {
        doc.text(mroSubDetails, left, currentY + 2, { width: pageW, align: 'left' });
    }

    doc.restore();
    return currentY + 16;
}

async function buildAdultHealthCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT 
            ahc.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel, p.street1, p.street2,
            p.city, p.state, p.zipcode, p.email as patient_email,
            p.b2b_client_id as patient_b2b_client_id,
            wl.b2b_client_id as waiting_list_b2b_client_id
        FROM adult_health_certificates ahc
        LEFT JOIN patient p ON ahc.patient_id = p.id
        LEFT JOIN waiting_list wl ON ahc.waiting_list_id = wl.id
        WHERE ahc.id = $1 AND ahc.deleted = false`,
        [id]
    );

    if (!cert) throw new Error('Certificate not found');
    decryptPIIFields(cert);

    const b2bClientId = cert.patient_b2b_client_id || cert.waiting_list_b2b_client_id;
    const lab = await resolveCertLabBranding(options.authUser, b2bClientId, cert.lab_test_id);
    const logoPath = await resolveCertLogoPath(lab);
    const sigPath = await resolveCertSignaturePath(lab);
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
            drawUnderlineField(doc, left + 36, y, 148, formatUsDate(cert.patient_dob), 10);
            doc.font('Times-Roman').fontSize(11).text('Tel #:', left + 198, y + 2);
            drawUnderlineField(doc, left + 238, y, 160, cert.tel, 10);
            y += rowH;

            // Address
            doc.font('Times-Roman').fontSize(11).text('Address:', left, y + 2);
            const fullAddress = [cert.street1, cert.street2, cert.city, cert.state, cert.zipcode]
                .filter(Boolean)
                .join(', ');
            drawUnderlineField(doc, left + 56, y, pageW - 56, fullAddress, 10);
            y += 40;

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
                examDate: cert.date_of_examination || cert.creation_timestamp || new Date(),
                clinicianAddress: cert.clinician_address,
                mroName: lab?.medical_officer_name,
                mrocc: lab?.mrocc,
                cliaNumber: lab?.clia_number,
                sigPath,
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
