const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { queryOne } = require('../db');

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'metrolab-logo.png');
const FALLBACK = {
    company: 'Metro Lab & Clinic LLC',
    addressLine: '3422 Georgia Avenue NW • Washington, D.C. 20010',
    addressShort: '3422 Georgia Ave NW Washington DC 20010',
    phone: '202.234.1234',
    fax: '202.234.1339',
    email: 'manager@metrolabdc.com',
    website: 'www.metrolabdc.com',
};

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

function resolveUploadedImagePath(filename) {
    if (!filename) return null;
    const clean = String(filename).trim();
    const normalized = clean.replace(/\\/g, '/');
    const baseName = path.basename(normalized);
    const bases = [
        path.join(__dirname, '..'),
        path.join(__dirname, '..', 'uploads'),
        path.join(__dirname, '..', 'uploads', 'b2bClients'),
        path.join(__dirname, '..', 'Uploads', 'b2bClients'),
    ];
    const candidates = [
        clean,
        normalized,
        baseName,
        path.join('uploads', baseName),
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
        `SELECT company_name, logo_file, address, public_phone_no, public_fax,
                public_email, website, medical_officer_signature_file_name, tagline
         FROM b2b_clients
         WHERE id = $1 AND deleted = false
         LIMIT 1`,
        [b2bId]
    );
}

function resolveCertLogoPath(lab) {
    const labLogo = resolveUploadedImagePath(lab?.logo_file);
    if (labLogo) return labLogo;
    if (fs.existsSync(DEFAULT_LOGO_PATH)) return DEFAULT_LOGO_PATH;
    return resolveUploadedImagePath('metrolablogo.png');
}

function sexLabel(sex) {
    if (sex === 1 || sex === '1' || String(sex || '').toLowerCase() === 'male') return 'Male';
    if (sex === 2 || sex === '2' || String(sex || '').toLowerCase() === 'female') return 'Female';
    return sex ? String(sex) : '';
}

function drawUnderlineField(doc, x, y, width, value) {
    const text = value ? String(value) : '';
    doc.moveTo(x, y + 11).lineTo(x + width, y + 11).strokeColor('#111').lineWidth(0.8).stroke();
    if (text) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
            .text(text, x + 2, y, { width: width - 4, align: 'center', lineBreak: false });
    }
}

function drawCheckbox(doc, x, y, checked) {
    doc.rect(x, y, 10, 10).lineWidth(1).strokeColor('#111').stroke();
    if (checked) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text('X', x + 1.5, y);
    }
}

async function buildPhysicalExamCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT 
            pec.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel, p.street1, p.street2,
            p.city, p.state, p.zipcode, p.email as patient_email
        FROM physical_examination_certificates pec
        LEFT JOIN patient p ON pec.patient_id = p.id
        WHERE pec.id = $1 AND pec.deleted = false`,
        [id]
    );

    if (!cert) throw new Error('Certificate not found');

    const lab = await resolveLoggedInLab(options.authUser);

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
                        filename: `Physical_Exam_Certificate_${cert.id}.pdf`,
                        password,
                    });
                } else {
                    resolve({ buffer: pdfBuffer, cert, filename: `Physical_Exam_Certificate_${cert.id}.pdf` });
                }
            });

            const left = 44;
            const right = doc.page.width - 44;
            const pageW = right - left;
            let y = 28;

            const company = labOrFallback(lab?.company_name, FALLBACK.company);
            const address = labOrFallback(lab?.address, FALLBACK.addressShort);
            const phone = labOrFallback(lab?.public_phone_no, FALLBACK.phone);
            const fax = labOrFallback(lab?.public_fax, FALLBACK.fax);
            const email = labOrFallback(lab?.public_email, FALLBACK.email);
            const website = String(labOrFallback(lab?.website, FALLBACK.website)).replace(/^https?:\/\//i, '');
            const bannerAddress = labOrFallback(lab?.address, FALLBACK.addressLine);
            const hasLabLogo = Boolean(resolveUploadedImagePath(lab?.logo_file));
            const logoPath = resolveCertLogoPath(lab);
            const fullAddress = [cert.street1, cert.street2, cert.city, cert.state, cert.zipcode]
                .filter(Boolean)
                .join(', ');

            // Watermark
            doc.save();
            doc.fillColor('#94a3b8', 0.08);
            doc.font('Helvetica-Bold').fontSize(56);
            doc.rotate(-28, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.text('METRO LAB', 80, doc.page.height / 2 - 18, { align: 'center', width: pageW + 40 });
            doc.restore();
            doc.fillColor('#111').opacity(1);

            // Banner
            if (logoPath) {
                try {
                    doc.image(logoPath, left, y, { fit: [78, 56] });
                } catch (err) {
                    console.warn('Could not embed PE certificate logo:', err.message);
                }
            }

            const brandX = left + 92;
            if (!hasLabLogo) {
                doc.font('Helvetica-Bold').fontSize(22).fillColor('#1e293b')
                    .text('METRO', brandX, y + 2, { continued: true });
                doc.fillColor('#c9a227').text(' LAB');
            } else {
                doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
                    .text(company, brandX, y + 6, { width: pageW - 100 });
            }
            doc.font('Times-Roman').fontSize(8).fillColor('#111');
            doc.text(bannerAddress, brandX, y + 30, { width: pageW - 100 });
            doc.text(`Phone: ${phone} • Fax: ${fax} • ${email}`, brandX, y + 41, { width: pageW - 100 });
            y += 64;

            doc.moveTo(left, y).lineTo(right, y).strokeColor('#6c9cd4').lineWidth(2).stroke();
            y += 3;
            doc.moveTo(left, y).lineTo(right, y).strokeColor('#6c9cd4').lineWidth(1).stroke();
            y += 10;

            doc.font('Times-Bold').fontSize(11).fillColor('#111').text(company, left, y, { align: 'center', width: pageW });
            y += 13;
            doc.font('Times-Roman').fontSize(9);
            doc.text(address, left, y, { align: 'center', width: pageW });
            y += 11;
            doc.text(`(Tell) ${phone} (Fax) ${fax}`, left, y, { align: 'center', width: pageW });
            y += 11;
            doc.text(website, left, y, { align: 'center', width: pageW });
            y += 14;

            doc.font('Times-Bold').fontSize(14).text('Physical Examination Certificate', left, y, {
                align: 'center',
                width: pageW,
            });
            y += 18;

            // Patient rows
            doc.font('Times-Roman').fontSize(10);
            doc.text('Name:', left, y + 1);
            drawUnderlineField(doc, left + 38, y, 220, cert.patient_name);
            doc.font('Times-Roman').fontSize(10).text('Age:', left + 275, y + 1);
            drawUnderlineField(doc, left + 300, y, 50, cert.age);
            doc.font('Times-Roman').fontSize(10).text('Sex:', left + 365, y + 1);
            drawUnderlineField(doc, left + 390, y, 70, sexLabel(cert.sex));
            y += 16;

            doc.font('Times-Roman').fontSize(10).text('Address:', left, y + 1);
            drawUnderlineField(doc, left + 50, y, 300, fullAddress);
            doc.font('Times-Roman').fontSize(10).text('Tel #:', left + 365, y + 1);
            drawUnderlineField(doc, left + 398, y, 62, cert.tel);
            y += 16;

            doc.font('Times-Roman').fontSize(10).text('Height:', left, y + 1);
            drawUnderlineField(doc, left + 42, y, 55, cert.height);
            doc.font('Times-Roman').fontSize(10).text('Weight:', left + 110, y + 1);
            drawUnderlineField(doc, left + 155, y, 55, cert.weight);
            doc.font('Times-Roman').fontSize(10).text('B.P:', left + 225, y + 1);
            drawUnderlineField(doc, left + 250, y, 70, cert.bp);
            doc.font('Times-Roman').fontSize(10).text('Pulse:', left + 335, y + 1);
            drawUnderlineField(doc, left + 370, y, 90, cert.pulse);
            y += 16;

            doc.font('Times-Roman').fontSize(10).text('Hearing: Right', left, y + 1);
            drawUnderlineField(doc, left + 85, y, 50, cert.hearing_right);
            doc.font('Times-Roman').fontSize(10).text('Left', left + 145, y + 1);
            drawUnderlineField(doc, left + 170, y, 50, cert.hearing_left);
            doc.font('Times-Roman').fontSize(10).text('Vision: Right', left + 235, y + 1);
            drawUnderlineField(doc, left + 310, y, 45, cert.vision_right);
            doc.font('Times-Roman').fontSize(10).text('Left', left + 365, y + 1);
            drawUnderlineField(doc, left + 390, y, 45, cert.vision_left);
            y += 16;

            doc.font('Times-Roman').fontSize(10).text('Wear Glasses:', left, y + 1);
            drawCheckbox(doc, left + 90, y + 1, !!cert.wear_glasses);
            doc.font('Times-Roman').fontSize(10).text('Yes', left + 106, y + 1);
            drawCheckbox(doc, left + 145, y + 1, !cert.wear_glasses);
            doc.font('Times-Roman').fontSize(10).text('No', left + 161, y + 1);
            y += 18;

            // Clinical evaluation
            doc.font('Times-Bold').fontSize(10).text('CLINICAL EVALUATION', left, y);
            doc.text('NORMAL', left + 250, y);
            doc.text('ABNORMAL', left + 330, y);
            y += 14;

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

            doc.font('Times-Roman').fontSize(10);
            items.forEach((item) => {
                doc.text(item.id, left, y);
                doc.text(item.label, left + 28, y);
                const isNormal = String(item.field || '').toLowerCase() === 'normal'
                    || String(item.field || '').toUpperCase() === 'N';
                const isAbnormal = String(item.field || '').toLowerCase() === 'abnormal'
                    || String(item.field || '').toUpperCase() === 'AB';
                if (isNormal) doc.font('Helvetica-Bold').text('X', left + 265, y);
                if (isAbnormal) doc.font('Helvetica-Bold').text('X', left + 355, y);
                doc.font('Times-Roman');
                y += 13;
            });

            y += 6;
            doc.font('Times-Roman').fontSize(10).text('13.', left, y);
            doc.text('Additional Comment, Past medical history, current medications:', left + 28, y);
            y += 14;
            doc.moveTo(left + 28, y + 11).lineTo(right, y + 11).strokeColor('#111').lineWidth(0.8).stroke();
            if (cert.additional_comments) {
                doc.font('Helvetica').fontSize(9).text(String(cert.additional_comments), left + 32, y, {
                    width: pageW - 36,
                    height: 12,
                    lineBreak: false,
                });
            }
            y += 20;

            doc.font('Times-Roman').fontSize(10).text('14.', left, y);
            doc.text('Overall Physical Condition', left + 28, y);
            drawCheckbox(doc, left + 200, y, cert.overall_condition === 'Fit');
            doc.text('Fit', left + 216, y);
            drawCheckbox(doc, left + 260, y, cert.overall_condition === 'Unfit');
            doc.text('Unfit', left + 276, y);
            y += 20;

            // Signature
            doc.font('Times-Roman').fontSize(10).text('Name/ Signature of examining Clinician:', left, y + 1);
            const sigX = left + 210;
            const sigW = 200;
            const sigPath = resolveUploadedImagePath(lab?.medical_officer_signature_file_name);
            if (sigPath) {
                try {
                    doc.image(sigPath, sigX + 40, y - 14, { fit: [110, 28] });
                } catch (_) { /* ignore */ }
            }
            drawUnderlineField(doc, sigX, y, sigW, cert.clinician_name);
            doc.font('Times-Roman').fontSize(10).text(
                cert.clinician_specialty || 'MD/PA/NP',
                sigX + sigW + 6,
                y + 1
            );
            y += 16;

            doc.font('Times-Roman').fontSize(10).text('Date of examination:', left, y + 1);
            drawUnderlineField(doc, left + 118, y, 130, formatUsDate(cert.date_of_examination));
            y += 16;

            doc.font('Times-Roman').fontSize(10).text('Address:', left, y + 1);
            drawUnderlineField(doc, left + 50, y, pageW - 50, cert.clinician_address);

            doc.font('Times-Bold').fontSize(10)
                .text(website, left, doc.page.height - 36, { align: 'center', width: pageW });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    buildPhysicalExamCertPdf,
};
