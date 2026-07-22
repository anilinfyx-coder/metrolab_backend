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

async function resolveCertLogoPath(lab) {
    const labLogo = await resolveUploadedFilePath(lab?.logo_file, { prefix: PREFIX.b2bClients });
    if (labLogo) return labLogo;
    return resolveLabLogoPath(lab);
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

const AUTH_H = 118;

function drawDigitalAuthBlock(doc, { left, pageW, y, clinicianName, specialty, examDate, clinicianAddress }) {
    const headerH = 26;
    const noteH = 28;
    const bodyH = AUTH_H - headerH - noteH;

    doc.save();
    doc.lineWidth(1.3).strokeColor('#1e40af');
    doc.roundedRect(left, y, pageW, AUTH_H, 4).stroke();

    doc.rect(left, y, pageW, headerH).fill('#eff6ff');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1e40af')
        .text('ELECTRONICALLY AUTHENTICATED CERTIFICATE', left, y + 8, {
            width: pageW,
            align: 'center',
            lineBreak: false,
        });

    const padX = 16;
    const colW = (pageW - padX * 2 - 20) / 2;
    const leftCol = left + padX;
    const rightCol = left + padX + colW + 20;
    let iy = y + headerH + 12;

    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
        .text('Digitally Signed By', leftCol, iy, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
        .text(clinicianName ? String(clinicianName) : '—', leftCol, iy + 12, {
            width: colW,
            lineBreak: false,
            ellipsis: true,
        });
    doc.font('Helvetica').fontSize(9).fillColor('#334155')
        .text(specialty ? String(specialty) : 'MD / PA / NP', leftCol, iy + 28, {
            width: colW,
            lineBreak: false,
        });

    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
        .text('Date of Examination', rightCol, iy, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
        .text(formatUsDate(examDate) || '—', rightCol, iy + 12, { lineBreak: false });

    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
        .text('Clinician Address', rightCol, iy + 28, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#334155')
        .text(clinicianAddress ? String(clinicianAddress) : '—', rightCol, iy + 40, {
            width: colW,
            height: 18,
            lineBreak: false,
            ellipsis: true,
        });

    const noteY = y + headerH + bodyH;
    doc.moveTo(left, noteY).lineTo(left + pageW, noteY)
        .strokeColor('#bfdbfe').lineWidth(0.8).stroke();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b')
        .text('This document is electronically authenticated. No physical signature is required.', left, noteY + 9, {
            width: pageW,
            align: 'center',
            lineBreak: false,
        });
    doc.restore();
    return y + AUTH_H;
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

            // —— Patient block (uniform row height) ——
            const rowH = 26;
            const labelSize = 10.5;

            // Name / Age / Sex
            let x = left;
            x = field(doc, 'Name:', cert.patient_name, x, y, 40, 248, 14);
            x = field(doc, 'Age:', cert.age, x, y, 30, 46, 14);
            field(doc, 'Sex:', sexLabel(cert.sex), x, y, 30, 72, 0);
            y += rowH;

            // Address / Tel
            x = left;
            x = field(doc, 'Address:', fullAddress, x, y, 54, 318, 14);
            field(doc, 'Tel #:', cert.tel, x, y, 38, 98, 0);
            y += rowH;

            // Height / Weight / B.P / Pulse — equal gaps
            const vitals = [
                { label: 'Height:', value: cert.height, lw: 46, fw: 58 },
                { label: 'Weight:', value: cert.weight, lw: 50, fw: 58 },
                { label: 'B.P:', value: cert.bp, lw: 30, fw: 72 },
                { label: 'Pulse:', value: cert.pulse, lw: 40, fw: 78 },
            ];
            x = left;
            vitals.forEach((v, i) => {
                const gap = i === vitals.length - 1 ? 0 : 16;
                x = field(doc, v.label, v.value, x, y, v.lw, v.fw, gap);
            });
            y += rowH;

            // Hearing / Vision
            x = left;
            x = field(doc, 'Hearing: Right', cert.hearing_right, x, y, 84, 72, 10);
            x = field(doc, 'Left', cert.hearing_left, x, y, 30, 72, 18);
            x = field(doc, 'Vision: Right', cert.vision_right, x, y, 74, 64, 10);
            field(doc, 'Left', cert.vision_left, x, y, 30, 64, 0);
            y += rowH;

            // Wear Glasses
            drawLabel(doc, 'Wear Glasses:', left, y, labelSize);
            const gX = left + 90;
            drawCheckbox(doc, gX, y + 2, !!cert.wear_glasses);
            drawLabel(doc, 'Yes', gX + CHECKBOX_SIZE + 6, y, labelSize);
            drawCheckbox(doc, gX + 52, y + 2, !cert.wear_glasses);
            drawLabel(doc, 'No', gX + 52 + CHECKBOX_SIZE + 6, y, labelSize);
            y += rowH + 4;

            // —— Clinical evaluation (3-column grid) ——
            const labelColW = pageW - 170;
            const normalColW = 80;
            const abnormalColW = 90;
            const normalX = left + labelColW;
            const abnormalX = normalX + normalColW;

            doc.font('Times-Bold').fontSize(11).fillColor('#111');
            doc.text('CLINICAL EVALUATION', left, y, { width: labelColW - 8, lineBreak: false });
            doc.text('NORMAL', normalX, y, { width: normalColW, align: 'center', lineBreak: false });
            doc.text('ABNORMAL', abnormalX, y, { width: abnormalColW, align: 'center', lineBreak: false });
            y += 18;

            const items = [
                { id: '1.', label: 'Head & Neck', field: cert.eval_head },
                { id: '2.', label: 'Nose & Sinus', field: cert.eval_nose },
                { id: '3.', label: 'Mouth & Throat', field: cert.eval_mouth },
                { id: '4.', label: 'Ears', field: cert.eval_ears },
                { id: '5.', label: 'Eyes', field: cert.eval_eyes },
                { id: '6.', label: 'Lungs & Chest', field: cert.eval_lungs },
                { id: '7.', label: 'Heart', field: cert.eval_heart },
                { id: '8.', label: 'Vascular System', field: cert.eval_vascular },
                { id: '9.', label: 'Abdomen', field: cert.eval_abdomen },
                { id: '10.', label: 'Spine', field: cert.eval_spine },
                { id: '11.', label: 'Skin', field: cert.eval_skin },
                { id: '12.', label: 'Neurologic', field: cert.eval_neurologic },
            ];

            // Fill remaining page so auth sits near bottom without a huge empty band mid-page.
            const afterEvalFixed = 12 + 16 + 20 + 22 + 14 + AUTH_H; // comments + overall + gaps + auth
            const spaceForRows = Math.max(items.length * 16, pageBottom - y - afterEvalFixed);
            const evalRowH = Math.min(20, Math.max(16, spaceForRows / items.length));
            const markSize = 12;

            items.forEach((item) => {
                doc.font('Times-Roman').fontSize(11).fillColor('#111');
                doc.text(item.id, left, y + 1, { width: 28, lineBreak: false });
                doc.text(item.label, left + 30, y + 1, { width: labelColW - 40, lineBreak: false });

                if (isEvalNormal(item.field)) {
                    drawCheckMark(doc, normalX + (normalColW - markSize) / 2, y + 1, markSize);
                }
                if (isEvalAbnormal(item.field)) {
                    drawCheckMark(doc, abnormalX + (abnormalColW - markSize) / 2, y + 1, markSize);
                }
                y += evalRowH;
            });

            y += 10;

            // 13. Additional comments — label, then value on the next line (tight)
            doc.font('Times-Roman').fontSize(11).fillColor('#111');
            doc.text('13.', left, y, { width: 28, lineBreak: false });
            doc.text('Additional Comment, Past medical history, current medications:', left + 30, y, {
                width: pageW - 30,
                lineBreak: false,
            });
            y += 16;
            drawField(doc, left + 30, y, pageW - 30, cert.additional_comments, 10);
            y += 24;

            // 14. Overall condition
            doc.font('Times-Roman').fontSize(11).fillColor('#111');
            doc.text('14.', left, y, { width: 28, lineBreak: false });
            doc.text('Overall Physical Condition', left + 30, y, { lineBreak: false });
            const oX = left + 220;
            drawCheckbox(doc, oX, y + 1, cert.overall_condition === 'Fit');
            doc.text('Fit', oX + CHECKBOX_SIZE + 6, y, { lineBreak: false });
            drawCheckbox(doc, oX + 56, y + 1, cert.overall_condition === 'Unfit');
            doc.text('Unfit', oX + 56 + CHECKBOX_SIZE + 6, y, { lineBreak: false });
            y += 24;

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
