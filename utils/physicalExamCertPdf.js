const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { queryOne } = require('../db');
const {
    resolveCertLabBranding,
    resolveCertLogoPath,
    drawCertBannerHeader,
    drawCheckbox,
    drawCheckMark,
    labText,
    CHECKBOX_SIZE,
} = require('./certPdfCommon');
const { decryptPII } = require('./cryptoUtils');

const AUTH_H = 88;

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

function textOrNull(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
    return text;
}

function labOrFallback(labValue, fallback) {
    return textOrNull(labValue) || fallback;
}

/** Same branding rules as Adult Health Certificate PDF. */
async function resolveLoggedInLab(authUser) {
    if (!authUser || !authUser.id) return null;

    let b2bId = null;

    if (authUser.portal === 'b2b') {
        b2bId = authUser.id;
    } else {
        const admin = await queryOne(
            'SELECT user_id FROM admin_users WHERE id = $1 AND deleted = false LIMIT 1',
            [authUser.id]
        );
        if (admin?.user_id) {
            b2bId = admin.user_id;
        } else if (authUser.portal !== 'admin') {
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



function sexLabel(sex) {
    if (sex === 1 || sex === '1' || String(sex || '').toLowerCase() === 'male') return 'Male';
    if (sex === 2 || sex === '2' || String(sex || '').toLowerCase() === 'female') return 'Female';
    return sex ? String(sex) : '';
}

function isEvalNormal(field) {
    const s = String(field || '').trim();
    return s.toLowerCase() === 'normal' || s.toUpperCase() === 'N';
}

function isEvalAbnormal(field) {
    const s = String(field || '').trim();
    return s.toLowerCase() === 'abnormal' || s.toUpperCase() === 'AB';
}

/** Form underline: left-aligned value, consistent baseline. */
function drawField(doc, x, y, width, value, fontSize = 10.5) {
    const text = value != null && String(value).trim() !== '' ? String(value) : '';
    doc.save();
    doc.moveTo(x, y + 14).lineTo(x + width, y + 14).strokeColor('#111').lineWidth(0.75).stroke();
    if (text) {
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#111')
            .text(text, x + 3, y + 1, {
                width: width - 6,
                align: 'left',
                lineBreak: false,
                ellipsis: true,
            });
    }
    doc.restore();
}

function drawLabel(doc, text, x, y, fontSize = 10.5) {
    doc.font('Times-Roman').fontSize(fontSize).fillColor('#111')
        .text(text, x, y + 2, { lineBreak: false });
}

/**
 * Draw "Label ____value____" and return x after the field (+ gap).
 */
function field(doc, label, value, x, y, labelW, fieldW, gapAfter = 12) {
    drawLabel(doc, label, x, y);
    drawField(doc, x + labelW, y, fieldW, value);
    return x + labelW + fieldW + gapAfter;
}

function drawDigitalAuthBlock(doc, { left, pageW, y, clinicianName, specialty, examDate, clinicianAddress }) {
    doc.save();
    const rowH = 24;

    let currentY = y;
    doc.font('Times-Roman').fontSize(11).fillColor('#111');
    doc.text('Name/Signature of examining Clinician:', left, currentY + 2, { lineBreak: false });
    const label1W = doc.widthOfString('Name/Signature of examining Clinician:') + 8;
    const nameLineW = 200;
    const nameX = left + label1W;
    
    doc.moveTo(nameX, currentY + 14).lineTo(nameX + nameLineW, currentY + 14).strokeColor('#111').lineWidth(0.8).stroke();
    if (clinicianName) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111');
        doc.text(String(clinicianName), nameX, currentY + 1, { width: nameLineW, align: 'center', lineBreak: false });
    }
    
    const specX = nameX + nameLineW + 8;
    doc.font('Times-Roman').fontSize(11).fillColor('#111');
    doc.text(specialty ? String(specialty) : 'MD/PA/NP', specX, currentY + 2, { lineBreak: false });
    currentY += rowH;

    doc.font('Times-Roman').fontSize(11).fillColor('#111');
    doc.text('Date of examination:', left, currentY + 2, { lineBreak: false });
    const label2W = doc.widthOfString('Date of examination:') + 8;
    const dateLineW = 160;
    const dateX = left + label2W;
    
    doc.moveTo(dateX, currentY + 14).lineTo(dateX + dateLineW, currentY + 14).strokeColor('#111').lineWidth(0.8).stroke();
    if (examDate) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111');
        doc.text(formatUsDate(examDate), dateX, currentY + 1, { width: dateLineW, align: 'center', lineBreak: false });
    }
    currentY += rowH;

    doc.font('Times-Roman').fontSize(11).fillColor('#111');
    doc.text('Address:', left, currentY + 2, { lineBreak: false });
    const label3W = doc.widthOfString('Address:') + 8;
    const addrLineW = 340;
    const addrX = left + label3W;
    
    doc.moveTo(addrX, currentY + 14).lineTo(addrX + addrLineW, currentY + 14).strokeColor('#111').lineWidth(0.8).stroke();
    if (clinicianAddress) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111');
        doc.text(String(clinicianAddress), addrX, currentY + 1, { width: addrLineW, align: 'center', lineBreak: false, ellipsis: true });
    }
    currentY += rowH;

    doc.restore();
    return currentY + 16;
}

async function buildPhysicalExamCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT
            pec.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel,
            p.street1, p.street2, p.city, p.state, p.zipcode, p.email as patient_email, p.b2b_client_id
         FROM physical_examination_certificates pec
         LEFT JOIN patient p ON pec.patient_id = p.id
         WHERE pec.id = $1 AND pec.deleted = false`,
        [id]
    );

    if (!cert) throw new Error('Certificate not found');
    if (cert.patient_dob) cert.patient_dob = decryptPII(cert.patient_dob);

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
                    resolve({
                        buffer: encryptPdfBuffer(pdfBuffer, password),
                        cert,
                        filename: `Physical_Exam_Certificate_${cert.id}.pdf`,
                        password,
                        lab,
                    });
                } else {
                    resolve({
                        buffer: pdfBuffer,
                        cert,
                        filename: `Physical_Exam_Certificate_${cert.id}.pdf`,
                        lab,
                    });
                }
            });

            const left = 48;
            const right = doc.page.width - 48;
            const pageW = right - left;
            const pageBottom = doc.page.height - 42;
            let y = 30;

            const company = labText(lab?.company_name);
            const address = labText(lab?.address);
            const phone = labText(lab?.public_phone_no);
            const fax = labText(lab?.public_fax);
            const email = labText(lab?.public_email);
            const fullAddress = [cert.street1, cert.street2, cert.city, cert.state, cert.zipcode]
                .filter(Boolean)
                .join(', ');

            if (company) {
                doc.save();
                doc.fillColor('#94a3b8', 0.06);
                doc.font('Helvetica-Bold').fontSize(44);
                doc.rotate(-28, { origin: [doc.page.width / 2, doc.page.height / 2] });
                doc.text(company, 80, doc.page.height / 2 - 16, { align: 'center', width: pageW + 40 });
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

            doc.font('Times-Bold').fontSize(16).fillColor('#111')
                .text('Physical Examination Certificate', left, y, {
                    width: pageW,
                    align: 'center',
                    lineBreak: false,
                });
            y += 26;

            // —— Patient block ——
            const rowH = 26;
            const labelSize = 10.5;

            // Row 1: Name, DOB, Tel #
            let x = left;
            x = field(doc, 'Name:', cert.patient_name, x, y, 40, 220, 16);
            x = field(doc, 'DOB:', formatUsDate(cert.patient_dob), x, y, 32, 70, 16);
            field(doc, 'Tel #:', cert.tel, x, y, 32, 100, 0);
            y += rowH;

            // Row 2: Address
            x = left;
            field(doc, 'Address:', fullAddress, x, y, 50, 464, 0);
            y += rowH;

            // Row 3: Sex, Age, Height, Weight
            x = left;
            x = field(doc, 'Sex:', sexLabel(cert.sex), x, y, 26, 60, 16);
            x = field(doc, 'Age:', cert.age, x, y, 28, 50, 16);
            x = field(doc, 'Height:', cert.height, x, y, 38, 60, 16);
            field(doc, 'Weight:', cert.weight, x, y, 42, 60, 0);
            y += rowH + 8;

            // Evaluation Key
            doc.font('Times-Bold').fontSize(11).fillColor('#111')
                .text('EVALUATED with corresponding letter', left + 12, y);
            y += 14;
            doc.text('NORMAL = N', left + 12, y, { lineBreak: false });
            doc.text('ABNORMAL = AB', left + 140, y);
            y += 24;

            // Vitals
            x = left;
            x = field(doc, 'Blood pressure: -', cert.bp, x, y, 92, 180, 20);
            field(doc, 'Pulse: -', cert.pulse, x, y, 42, 150, 0);
            y += rowH;

            x = left;
            x = field(doc, 'Hearing: Right:', cert.hearing_right, x, y, 80, 140, 20);
            field(doc, 'Left:', cert.hearing_left, x, y, 28, 140, 0);
            y += rowH;

            x = left;
            x = field(doc, 'Vision: Right 20 /', cert.vision_right, x, y, 96, 76, 16);
            x = field(doc, 'Left 20 /', cert.vision_left, x, y, 50, 76, 20);
            
            drawLabel(doc, 'Wear glasses:', x, y, labelSize);
            x += 74;
            drawCheckbox(doc, x, y + 2, !!cert.wear_glasses);
            drawLabel(doc, 'Yes', x + CHECKBOX_SIZE + 4, y, labelSize);
            x += CHECKBOX_SIZE + 32;
            drawCheckbox(doc, x, y + 2, !cert.wear_glasses && cert.wear_glasses !== null);
            drawLabel(doc, 'No', x + CHECKBOX_SIZE + 4, y, labelSize);
            y += rowH + 12;

            // —— List of Eval Items ——
            const items = [
                { id: '1.', label: 'Head, Neck, Face & Scalp', field: cert.eval_head },
                { id: '2.', label: 'Nose and Sinuses', field: cert.eval_nose },
                { id: '3.', label: 'Mouth and Throat', field: cert.eval_mouth },
                { id: '4.', label: 'Ears', field: cert.eval_ears },
                { id: '5.', label: 'Eyes, Pupils and Ocular Motion', field: cert.eval_eyes },
                { id: '6.', label: 'Lungs, Chest, and Breasts', field: cert.eval_lungs },
                { id: '7.', label: 'Heart', field: cert.eval_heart },
                { id: '8.', label: 'Vascular System', field: cert.eval_vascular },
                { id: '9.', label: 'Abdomen and Viscera', field: cert.eval_abdomen },
                { id: '10.', label: 'Spine, other Muscular Skeletal System', field: cert.eval_spine },
                { id: '11.', label: 'Skin and Lymphatic', field: cert.eval_skin },
                { id: '12.', label: 'Neurologic', field: cert.eval_neurologic },
            ];

            const evalRowH = 18;
            items.forEach((item) => {
                doc.font('Times-Roman').fontSize(11).fillColor('#111');
                doc.text(`${item.id} ${item.label}`, left + 20, y + 2, { width: 220, lineBreak: false });
                
                let valStr = '';
                if (isEvalNormal(item.field)) valStr = 'N';
                else if (isEvalAbnormal(item.field)) valStr = 'AB';
                else valStr = item.field || '';
                
                drawField(doc, left + 240, y, 160, valStr, 11);
                y += evalRowH;
            });

            y += 10;

            // 13. Additional comments
            doc.font('Times-Roman').fontSize(11).fillColor('#111');
            doc.text('13. Additional Comment, Past medical history, current medications:', left + 20, y);
            y += 16;
            drawField(doc, left + 20, y, pageW - 20, cert.additional_comments, 11);
            y += 32;

            // 14. Overall condition
            doc.font('Times-Roman').fontSize(11).fillColor('#111');
            doc.text('14. Overall Physical Condition', left + 20, y + 2, { lineBreak: false });
            
            let oX = left + 220;
            doc.text('Fit', oX, y + 2, { lineBreak: false });
            drawField(doc, oX + 22, y, 70, cert.overall_condition === 'Fit' ? '✔' : '');
            
            oX += 120;
            doc.text('Unfit', oX, y + 2, { lineBreak: false });
            drawField(doc, oX + 34, y, 70, cert.overall_condition === 'Unfit' ? '✔' : '');
            y += 32;

            // Auth footer — just below content; nudge down only if a little leftover room
            let authY = y + 10;
            const leftover = pageBottom - AUTH_H - authY;
            if (leftover > 8 && leftover < 36) {
                authY += leftover;
            }
            if (authY + AUTH_H > pageBottom) {
                authY = pageBottom - AUTH_H;
            }

            drawDigitalAuthBlock(doc, {
                left,
                pageW,
                y: authY,
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
    buildPhysicalExamCertPdf,
};
