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
                l.name as lab_test_name,
                st.name as specimen_type_name
         FROM lab_test_category_report r
         LEFT JOIN patient p ON p.id = r.patient_id
         LEFT JOIN lab_tests l ON l.id = r.lab_test_id
         LEFT JOIN specimen_type st ON st.id = r.specimen_type_id
         WHERE r.id = $1 AND r.deleted = false
         LIMIT 1`,
        [reportId]
    );
    if (!report) return null;

    const b2bClientId = report.patient_b2b_client_id || null;
    const b2b = b2bClientId
        ? await queryOne(
            `SELECT company_name, tagline, public_phone_no, public_fax, public_email, email,
                    address, medical_officer_name, mrocc, clia_number,
                    medical_officer_signature_file_name
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

function drawLabelValue(doc, x, y, label, value, labelWidth = 130) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222').text(label, x, y, { width: labelWidth, continued: false });
    doc.font('Helvetica').fontSize(9).fillColor('#222').text(value || '—', x + labelWidth, y, { width: 160 });
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

            // Header
            doc.font('Helvetica-Bold').fontSize(20).fillColor('#1a5f9e')
                .text(b2b?.company_name || 'METRO LAB', left, 40, { width: 260 });
            if (b2b?.tagline) {
                doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555')
                    .text(b2b.tagline, left, 64, { width: 260 });
            }

            const contactX = left + 300;
            doc.font('Helvetica').fontSize(8).fillColor('#333');
            let cy = 42;
            const fax = b2b?.public_fax || '';
            const phone = b2b?.public_phone_no || '';
            const email = b2b?.public_email || b2b?.email || '';
            const address = b2b?.address || '';
            if (fax) { doc.text(`FAX: ${fax}`, contactX, cy, { width: 220, align: 'right' }); cy += 11; }
            if (phone) { doc.text(phone, contactX, cy, { width: 220, align: 'right' }); cy += 11; }
            if (email) { doc.text(email, contactX, cy, { width: 220, align: 'right' }); cy += 11; }
            if (address) { doc.text(address, contactX, cy, { width: 220, align: 'right' }); cy += 11; }

            let y = Math.max(90, cy + 8);
            doc.moveTo(left, y).lineTo(right, y).strokeColor('#1a5f9e').lineWidth(1.5).stroke();
            y += 12;

            doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
                .text(report.lab_test_name || 'Lab Test Report', left, y, { width: contentWidth, align: 'center' });
            y += 20;
            doc.font('Helvetica').fontSize(9).fillColor('#333')
                .text(`Report Printed On: ${formatUsDateTime(new Date())}`, left, y, { width: contentWidth, align: 'right' });
            y += 18;

            // Meta two columns
            const mid = left + contentWidth / 2 + 10;
            let yL = y;
            let yR = y;
            yL = drawLabelValue(doc, left, yL, 'UID:', `#${report.uid || report.id}`);
            yL = drawLabelValue(doc, left, yL, 'Test Performed by:', report.test_performed_by || '—');
            yL = drawLabelValue(doc, left, yL, 'Medical Officer:', b2b?.medical_officer_name || '—');
            yL = drawLabelValue(doc, left, yL, 'CLIA No.:', b2b?.clia_number || '—');

            yR = drawLabelValue(doc, mid, yR, 'Reason for Test:', report.reason_for_test || '—');
            yR = drawLabelValue(doc, mid, yR, 'Reported Status:', report.report_status || '—');
            yR = drawLabelValue(doc, mid, yR, 'Regulation:', report.regulation || '—');
            yR = drawLabelValue(doc, mid, yR, 'MROCC:', b2b?.mrocc || '—');
            y = Math.max(yL, yR) + 8;

            doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
            y += 10;

            yL = y;
            yR = y;
            yL = drawLabelValue(doc, left, yL, 'Service and Specimen Type:', report.specimen_type_name || '—', 150);
            yL = drawLabelValue(doc, left, yL, 'Received Date/Time:', formatUsDateTime(report.received_timestamp), 150);
            yR = drawLabelValue(doc, mid, yR, 'Collection Date/Time:', formatUsDateTime(report.collected_timestamp), 140);
            yR = drawLabelValue(doc, mid, yR, 'Reported Date/Time:', formatUsDateTime(report.reported_timestamp), 140);
            y = Math.max(yL, yR) + 8;

            doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
            y += 10;

            // Patient demographics
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5f9e').text('Patient/Donor', left, y);
            y += 16;
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
            y = Math.max(yL, yR) + 12;

            // Parameters table
            if (parameters && parameters.length > 0) {
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5f9e').text('Drugs Tested', left, y);
                y += 14;

                const cols = [
                    { key: 'label', title: 'Drug Name', w: 170 },
                    { key: 'value', title: 'Result', w: 90 },
                    { key: 'screen', title: 'Laboratory Screening Cutoff', w: 140 },
                    { key: 'confirm', title: 'Laboratory Confirmation Cutoff', w: contentWidth - 170 - 90 - 140 },
                ];

                const rowH = 18;
                // header
                doc.rect(left, y, contentWidth, rowH).fill('#e8f1f8');
                doc.fillColor('#111').font('Helvetica-Bold').fontSize(8);
                let x = left + 4;
                cols.forEach((c) => {
                    doc.text(c.title, x, y + 5, { width: c.w - 8 });
                    x += c.w;
                });
                y += rowH;

                parameters.forEach((p, idx) => {
                    if (y > doc.page.height - 120) {
                        doc.addPage();
                        y = 40;
                    }
                    if (idx % 2 === 1) {
                        doc.rect(left, y, contentWidth, rowH).fill('#f7f9fc');
                    }
                    doc.fillColor('#222').font('Helvetica').fontSize(8);
                    const vals = [
                        p.label || '—',
                        p.value || '—',
                        formatCutoff(p.screening_cutoff, p.unit_text),
                        formatCutoff(p.confirmation_cutoff, p.unit_text),
                    ];
                    x = left + 4;
                    vals.forEach((v, i) => {
                        doc.text(String(v), x, y + 5, { width: cols[i].w - 8 });
                        x += cols[i].w;
                    });
                    y += rowH;
                });
                y += 10;
            }

            if (y > doc.page.height - 160) {
                doc.addPage();
                y = 40;
            }

            doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
            y += 10;
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5f9e')
                .text('To Be Completed By Medical Review Officer', left, y);
            y += 16;

            y = drawLabelValue(doc, left, y, 'Final Result:', report.final_result || '—', 150);
            y = drawLabelValue(doc, left, y, 'Remark:', report.test_remark || '—', 150);
            y = drawLabelValue(doc, left, y, 'Final Result Disposition:', report.final_result_disposition || '—', 150);
            y = drawLabelValue(doc, left, y, 'Final Remark:', report.final_remark || '—', 150);
            y += 16;

            doc.font('Helvetica').fontSize(9).fillColor('#222')
                .text(`Medical Review Officer's Name: ${b2b?.medical_officer_name || '—'}`, left, y);
            y += 28;
            doc.text('Signature: ______________________________', left, y);
            doc.text(`Date (MM/DD/YY): ${formatUsDateShort(new Date())}`, left + 280, y);
            y += 24;

            doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666')
                .text('* Represents laboratory screening and confirmation values', left, y);

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
