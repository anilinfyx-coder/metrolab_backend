const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { query, queryOne } = require('../db');

function pad(n) {
    return String(n).padStart(2, '0');
}

function formatUsDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ap}`;
}

function formatUsDate(value) {
    if (!value) return '—';
    // Prefer calendar date to avoid timezone shifting DOB
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const [y, m, day] = value.slice(0, 10).split('-').map(Number);
        return `${m}/${day}/${y}`;
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatUsDateShort(value) {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(-2)}`;
}

function calcAge(dob) {
    if (!dob) return '—';
    let y; let m; let day;
    if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dob)) {
        [y, m, day] = dob.slice(0, 10).split('-').map(Number);
    } else {
        const d = new Date(dob);
        if (Number.isNaN(d.getTime())) return '—';
        y = d.getUTCFullYear();
        m = d.getUTCMonth() + 1;
        day = d.getUTCDate();
    }
    const now = new Date();
    let age = now.getFullYear() - y;
    const mm = now.getMonth() + 1;
    const dd = now.getDate();
    if (mm < m || (mm === m && dd < day)) age -= 1;
    return age >= 0 ? String(age) : '—';
}

function genderLabel(gender) {
    if (gender === 1 || gender === '1') return 'Male';
    if (gender === 2 || gender === '2') return 'Female';
    if (gender === 3 || gender === '3') return 'Other';
    return gender ? String(gender) : '—';
}

function formatCutoff(value, unit) {
    if (value === null || value === undefined || value === '' || value === 'Null' || value === 'null') {
        return '—';
    }
    const unitText = unit && unit !== 'Null' && unit !== 'null' ? ` ${unit}` : '';
    return `${value}${unitText}`;
}

/**
 * Password = MMDD from patient DOB (4 digits), e.g. 9/9/2003 -> 0909
 */
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
        // Use UTC for DATE/TIMESTAMPTZ DOB fields to avoid local shift
        m = d.getUTCMonth() + 1;
        day = d.getUTCDate();
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
        try { fs.unlinkSync(inPath); } catch (_) { /* ignore */ }
        try { fs.unlinkSync(outPath); } catch (_) { /* ignore */ }
        try { fs.rmdirSync(tmpDir); } catch (_) { /* ignore */ }
    }
}

async function loadLabTestReportBundle(reportId) {
    const report = await queryOne(
        `SELECT r.*,
                p.name as patient_name,
                p.uid as patient_uid,
                p.email as patient_email,
                p.mobile as patient_mobile,
                p.dob::text as patient_dob,
                p.gender as patient_gender,
                p.ssn as patient_ssn,
                p.street1 as patient_street1,
                p.street2 as patient_street2,
                p.city as patient_city,
                p.state as patient_state,
                p.zipcode as patient_zipcode,
                p.b2b_client_id as patient_b2b_client_id,
                wl.b2b_client_id as waiting_list_b2b_client_id,
                l.name as lab_test_name,
                st.name as specimen_type_name
         FROM lab_test_category_report r
         LEFT JOIN patient p ON p.id = r.patient_id
         LEFT JOIN waiting_list wl ON wl.id = r.waiting_list_id
         LEFT JOIN lab_tests l ON l.id = r.lab_test_id
         LEFT JOIN specimen_type st ON st.id = r.specimen_type_id
         WHERE r.id = $1 AND r.deleted = false
         LIMIT 1`,
        [reportId]
    );
    if (!report) return null;

    const b2bClientId =
        report.patient_b2b_client_id ||
        report.waiting_list_b2b_client_id ||
        null;
    const b2b = b2bClientId
        ? await queryOne(
            `SELECT company_name, tagline, public_phone_no, public_fax, public_email, email,
                    address, medical_officer_name, mrocc, clia_number,
                    medical_officer_signature_file_name, logo_file, report_header_file
             FROM b2b_clients WHERE id = $1 LIMIT 1`,
            [b2bClientId]
        )
        : null;

    const { rows: parameters } = await query(
        `SELECT rp.id,
                COALESCE(rp.label, rp.name) as label,
                rp.screening_cutoff,
                rp.confirmation_cutoff,
                rp.unit_text,
                COALESCE(v.value, '') as value
         FROM report_request_parameters rp
         LEFT JOIN lab_test_category_report_request_parameter_value v
           ON v.report_request_parameters_id = rp.id
          AND v.lab_test_category_report_id = $1
          AND v.deleted = false
         WHERE rp.lab_test_id = $2 AND rp.deleted = false
         ORDER BY rp.id ASC`,
        [reportId, report.lab_test_id]
    );

    return { report, b2b, parameters };
}

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'assets', 'metrolab-logo.png');

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

function resolveReportLogoPath(b2b) {
    const uploadedLogo =
        resolveUploadedImagePath(b2b?.logo_file) ||
        resolveUploadedImagePath(b2b?.report_header_file);
    if (uploadedLogo && !uploadedLogo.toLowerCase().endsWith('.webp')) {
        return uploadedLogo;
    }
    if (fs.existsSync(DEFAULT_LOGO_PATH)) return DEFAULT_LOGO_PATH;
    return null;
}

function drawContactLine(doc, x, y, width, text) {
    doc.font('Helvetica').fontSize(9).fillColor('#222').text(text, x, y, { width, align: 'right' });
    return y + 12;
}

function drawLabelValue(doc, x, y, label, value, labelWidth = 130) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222').text(label, x, y, { width: labelWidth, continued: false });
    doc.font('Helvetica').fontSize(9).fillColor('#222').text(value || '—', x + labelWidth, y, { width: 160 });
    return y + 16;
}

function drawReportHeader(doc, bundle) {
    const { report, b2b } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;
    const contactX = left + 270;
    const contactWidth = contentWidth - 270;

    let headerBottom = 40;
    const logoPath = resolveReportLogoPath(b2b);

    if (logoPath) {
        try {
            doc.image(logoPath, left, 34, { fit: [170, 78] });
            headerBottom = 34 + 78;
        } catch (err) {
            console.warn('Could not embed report logo:', err.message);
            doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a5f9e')
                .text(b2b?.company_name || 'METRO LAB', left, 40, { width: 260 });
            if (b2b?.tagline) {
                doc.font('Helvetica').fontSize(8).fillColor('#555')
                    .text(b2b.tagline, left, 62, { width: 260 });
            }
            headerBottom = 78;
        }
    } else {
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a5f9e')
            .text(b2b?.company_name || 'METRO LAB', left, 40, { width: 260 });
        if (b2b?.tagline) {
            doc.font('Helvetica').fontSize(8).fillColor('#555')
                .text(b2b.tagline, left, 62, { width: 260 });
        }
        headerBottom = 78;
    }

    let cy = 38;
    const fax = b2b?.public_fax || '';
    const phone = b2b?.public_phone_no || '';
    const email = b2b?.public_email || b2b?.email || '';
    const address = b2b?.address || '';

    if (fax) cy = drawContactLine(doc, contactX, cy, contactWidth, `FAX : ${fax}`);
    if (phone) cy = drawContactLine(doc, contactX, cy, contactWidth, `Phone Number : ${phone}`);
    if (email) cy = drawContactLine(doc, contactX, cy, contactWidth, `Email : ${email}`);
    if (address) cy = drawContactLine(doc, contactX, cy, contactWidth, address);

    let y = Math.max(headerBottom + 12, cy + 6);

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
        .text(report.lab_test_name || 'Lab Test Report', left, y, { width: contentWidth, align: 'center' });
    y += 22;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222')
        .text(`Report Printed On: ${formatUsDateTime(new Date())}`, left, y, { width: contentWidth, align: 'right' });
    y += 16;

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 12;

    const mid = left + contentWidth / 2 + 10;
    let yL = y;
    let yR = y;
    yL = drawLabelValue(doc, left, yL, 'UID:', `#${report.uid || report.id}`);
    yL = drawLabelValue(doc, left, yL, 'Test Performed by:', report.test_performed_by || '—');
    yL = drawLabelValue(doc, left, yL, 'Medical Officer:', b2b?.medical_officer_name || '—');

    yR = drawLabelValue(doc, mid, yR, 'Reason for Test:', report.reason_for_test || '—');
    yR = drawLabelValue(doc, mid, yR, 'Reported Status:', report.report_status || '—');
    yR = drawLabelValue(doc, mid, yR, 'Regulation:', report.regulation || '—');

    return Math.max(yL, yR) + 14;
}

function drawBoldInlineField(doc, x, y, label, value, width = 500) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222').text(label, x, y, { width, continued: true });
    doc.font('Helvetica').fontSize(9).fillColor('#222').text(` ${value || '—'}`);
    return y + 16;
}

function drawDrugsTestedSection(doc, bundle, startY) {
    const { parameters } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;
    let y = startY + 12;

    if (!parameters || parameters.length === 0) return startY;

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text('Drugs Tested', left, y, { width: contentWidth, align: 'center' });
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 8;

    const cols = [
        { title: 'Drug Name', w: 185 },
        { title: 'Result', w: 70 },
        { title: 'Laboratory Screening Cutoff*', w: 138 },
        { title: 'Laboratory Confirmation Cutoff*', w: contentWidth - 185 - 70 - 138 },
    ];
    const rowH = 16;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    let x = left + 4;
    cols.forEach((c) => {
        doc.text(c.title, x, y + 3, { width: c.w - 8 });
        x += c.w;
    });
    y += rowH;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.5).stroke();

    parameters.forEach((p) => {
        if (y > doc.page.height - 220) {
            doc.addPage();
            y = 40;
        }
        const vals = [
            p.label || '—',
            p.value || '—',
            formatCutoff(p.screening_cutoff, p.unit_text),
            formatCutoff(p.confirmation_cutoff, p.unit_text),
        ];
        doc.font('Helvetica').fontSize(8).fillColor('#222');
        x = left + 4;
        vals.forEach((v, i) => {
            doc.text(String(v), x, y + 3, { width: cols[i].w - 8 });
            x += cols[i].w;
        });
        y += rowH;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.5).stroke();
    });

    return y + 18;
}

function drawMroSection(doc, bundle, startY) {
    const { report } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;
    let y = startY + 16;

    if (y > doc.page.height - 220) {
        doc.addPage();
        y = 40;
    }

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text('To Be Completed By Medical Review Officer', left, y, { width: contentWidth, align: 'center' });
    y += 22;

    doc.font('Helvetica').fontSize(9).fillColor('#222')
        .text(
            'I have reviewed the laboratory result for the specimen identified by this form in accordance with applicable federal requirements. My determination / verification is',
            left,
            y,
            { width: contentWidth, align: 'left' }
        );
    y += 34;

    y = drawBoldInlineField(doc, left, y, 'Final Result :', report.final_result || '—', contentWidth);
    y = drawBoldInlineField(doc, left, y, 'Remark :', report.test_remark || '—', contentWidth);
    y = drawBoldInlineField(doc, left, y, 'Final Result Disposition:', report.final_result_disposition || '—', contentWidth);
    y = drawBoldInlineField(doc, left, y, 'Final Remark:', report.final_remark || '—', contentWidth);

    return y + 20;
}

function drawReportFooter(doc, bundle, startY) {
    const { report, b2b } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;
    let y = startY + 10;

    if (y > doc.page.height - 130) {
        doc.addPage();
        y = 40;
    }

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 18;

    const colW = contentWidth / 3;
    const officerName = b2b?.medical_officer_name || '—';
    const reportDate = formatUsDateShort(report.reported_timestamp || new Date());
    const sigPath = resolveUploadedImagePath(b2b?.medical_officer_signature_file_name);

    const valueY = y;
    const labelY = y + 34;

    doc.font('Helvetica').fontSize(9).fillColor('#222')
        .text(officerName, left, valueY, { width: colW, align: 'center' });

    if (sigPath && !sigPath.toLowerCase().endsWith('.webp')) {
        try {
            doc.image(sigPath, left + colW + (colW - 110) / 2, valueY - 4, { fit: [110, 28] });
        } catch (err) {
            console.warn('Could not embed medical officer signature:', err.message);
        }
    }

    doc.font('Helvetica').fontSize(9).fillColor('#222')
        .text(reportDate, left + colW * 2, valueY, { width: colW, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111')
        .text("Medical Review Officer's Name", left, labelY, { width: colW, align: 'center' });
    doc.text('Signature of Medical Review Officer', left + colW, labelY, { width: colW, align: 'center' });
    doc.text('Date (MM/DD/YY)', left + colW * 2, labelY, { width: colW, align: 'center' });

    y = labelY + 22;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 14;

    doc.font('Helvetica').fontSize(8).fillColor('#222')
        .text('* Represents laboratory screening and confirmation values', left, y, { width: contentWidth, align: 'left' });

    return y + 14;
}

function generatePlainLabTestReportPdf(bundle) {
    return new Promise((resolve, reject) => {
        try {
            const { report, b2b, parameters } = bundle;
            const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;
            const left = 40;
            const right = pageWidth - 40;
            const contentWidth = right - left;

            let y = drawReportHeader(doc, bundle);

            doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
            y += 16;

            const mid = left + contentWidth / 2 + 10;
            let yL = y;
            let yR = y;
            yL = drawLabelValue(doc, left, yL, 'Service and Specimen Type:', report.specimen_type_name || '—', 150);
            yL = drawLabelValue(doc, left, yL, 'Received Date/Time:', formatUsDateTime(report.received_timestamp), 150);
            yR = drawLabelValue(doc, mid, yR, 'Collection Date/Time:', formatUsDateTime(report.collected_timestamp), 140);
            yR = drawLabelValue(doc, mid, yR, 'Reported Date/Time:', formatUsDateTime(report.reported_timestamp), 140);
            y = Math.max(yL, yR) + 12;

            doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
            y += 16;

            // Patient demographics
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5f9e').text('Patient/Donor', left, y);
            y += 20;
            yL = y;
            yR = y;
            yL = drawLabelValue(doc, left, yL, 'Name:', report.patient_name || '—');
            yL = drawLabelValue(doc, left, yL, 'Date Of Birth:', formatUsDate(report.patient_dob));
            yL = drawLabelValue(doc, left, yL, 'Phone No:', report.patient_mobile || '—');
            const addressParts = [
                report.patient_street1,
                report.patient_street2,
                report.patient_city,
                report.patient_state,
                report.patient_zipcode ? `ZipCode: ${report.patient_zipcode}` : null,
            ].filter((v) => v && String(v).trim());
            yL = drawLabelValue(doc, left, yL, 'Address:', addressParts.join(', ') || '—');

            yR = drawLabelValue(doc, mid, yR, 'SSN:', report.patient_ssn || '—');
            yR = drawLabelValue(doc, mid, yR, 'Age:', calcAge(report.patient_dob));
            yR = drawLabelValue(doc, mid, yR, 'Gender:', genderLabel(report.patient_gender));
            y = Math.max(yL, yR) + 18;

            y = drawDrugsTestedSection(doc, bundle, y);
            y = drawMroSection(doc, bundle, y);
            drawReportFooter(doc, bundle, y);

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Build report PDF buffer. If patient has DOB, PDF is password-protected with MMDD.
 * @returns {{ buffer: Buffer, filename: string, password: string|null, report: object }}
 */
async function buildLabTestReportPdf(reportId, { encrypt = true } = {}) {
    const bundle = await loadLabTestReportBundle(reportId);
    if (!bundle) {
        const err = new Error('Report not found');
        err.code = '404';
        throw err;
    }

    const plain = await generatePlainLabTestReportPdf(bundle);
    const password = buildBirthdatePassword(bundle.report.patient_dob);
    let buffer = plain;

    if (encrypt && password) {
        buffer = encryptPdfBuffer(plain, password);
    }

    const filename = `${bundle.report.uid || `Report-${bundle.report.id}`}.pdf`;
    return {
        buffer,
        filename,
        password: encrypt ? password : null,
        report: bundle.report,
        b2b: bundle.b2b,
    };
}

module.exports = {
    buildLabTestReportPdf,
    buildBirthdatePassword,
    loadLabTestReportBundle,
};
