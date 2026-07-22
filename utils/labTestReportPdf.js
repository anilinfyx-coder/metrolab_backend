const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { query, queryOne } = require('../db');
const {
    resolveOwnerB2bClientId,
    resolveLabTestWithDisplayOptions,
} = require('./labTestDisplayOptions');
const {
    resolveUploadedFilePath,
} = require('./uploadedFiles');
const { PREFIX } = require('./gcs');
const {
    resolveCertLabBranding,
    resolveCertLogoPath,
    drawCertBannerHeader,
    labText,
} = require('./certPdfCommon');

function showFlag(labTest, flag) {
    return !!(labTest && labTest[flag]);
}

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
        y = d.getFullYear();
        m = d.getMonth() + 1;
        day = d.getDate();
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
                wl.corporate_client_id as waiting_list_corporate_client_id,
                wl.reason_for_test as waiting_list_reason_for_test,
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

    const b2bClientId = await resolveOwnerB2bClientId({
        b2b_client_id: report.b2b_client_id || report.patient_b2b_client_id || report.waiting_list_b2b_client_id,
        waiting_list_id: report.waiting_list_id,
        patient_id: report.patient_id,
        corporate_client_id: report.corporate_client_id || report.waiting_list_corporate_client_id,
        lab_test_id: report.lab_test_id,
        created_by_id: report.created_by_id,
    });

    const { labTest } = await resolveLabTestWithDisplayOptions(report.lab_test_id, {
        b2b_client_id: b2bClientId,
        waiting_list_id: report.waiting_list_id,
        patient_id: report.patient_id,
        corporate_client_id: report.corporate_client_id || report.waiting_list_corporate_client_id,
        lab_test_id: report.lab_test_id,
        created_by_id: report.created_by_id,
    });

    report.reason_for_test = report.reason_for_test || report.waiting_list_reason_for_test || null;

    const b2b = b2bClientId
        ? await queryOne(
            `SELECT company_name, tagline, public_phone_no, public_fax, public_email, email,
                    address, medical_officer_name, mrocc, clia_number,
                    medical_officer_signature_file_name, logo_file, report_header_file
             FROM b2b_clients WHERE id = $1 LIMIT 1`,
            [b2bClientId]
        )
        : null;

    const paramFilter = b2bClientId
        ? `rp.lab_test_id = $2 AND rp.deleted = false AND (rp.b2b_client_id = $3 OR rp.b2b_client_id IS NULL)`
        : `rp.lab_test_id = $2 AND rp.deleted = false`;
    const paramParams = b2bClientId
        ? [reportId, report.lab_test_id, b2bClientId]
        : [reportId, report.lab_test_id];

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
         WHERE ${paramFilter}
         ORDER BY rp.id ASC`,
        paramParams
    );

    return { report, b2b, parameters, labTest, b2bClientId };
}

async function resolveReportLogoPath(b2b) {
    return resolveCertLogoPath(b2b);
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
    const { report, b2b, labTest, logoPath } = bundle;
    const left = 44;
    const right = doc.page.width - 44;
    const contentWidth = right - left;

    const company = labText(b2b?.company_name);
    const address = labText(b2b?.address);
    const phone = labText(b2b?.public_phone_no);
    const fax = labText(b2b?.public_fax);
    const email = labText(b2b?.public_email) || labText(b2b?.email);
    const hasLabLogo = Boolean(logoPath);

    let y = drawCertBannerHeader(doc, {
        left,
        right,
        y: 32,
        logoPath,
        hasLabLogo,
        company,
        address,
        phone,
        fax,
        email,
    });

    doc.font('Times-Bold').fontSize(16).fillColor('#111')
        .text(report.lab_test_name || 'Lab Test Report', left, y, { width: contentWidth, align: 'center' });
    y += 26;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222')
        .text(`Report Printed On: ${formatUsDateTime(new Date())}`, left, y, { width: contentWidth, align: 'right' });
    y += 18;

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 14;

    const mid = left + contentWidth / 2 + 10;
    let yL = y;
    let yR = y;
    yL = drawLabelValue(doc, left, yL, 'UID:', `#${report.uid || report.id}`);

    if (showFlag(labTest, 'show_test_performed_by')) {
        yL = drawLabelValue(doc, left, yL, 'Test Performed by:', report.test_performed_by || '—');
    }
    yL = drawLabelValue(doc, left, yL, 'Medical Officer:', b2b?.medical_officer_name || '—');

    if (showFlag(labTest, 'show_reason_for_test')) {
        yR = drawLabelValue(doc, mid, yR, 'Reason for Test:', report.reason_for_test || '—');
    }
    if (showFlag(labTest, 'show_report_status')) {
        yR = drawLabelValue(doc, mid, yR, 'Reported Status:', report.report_status || '—');
    }
    if (showFlag(labTest, 'show_regulation')) {
        yR = drawLabelValue(doc, mid, yR, 'Regulation:', report.regulation || '—');
    }

    return Math.max(yL, yR) + 16;
}

function drawBoldInlineField(doc, x, y, label, value, width = 500) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222').text(label, x, y, { width, continued: true });
    doc.font('Helvetica').fontSize(9).fillColor('#222').text(` ${value || '—'}`);
    return y + 16;
}

function drawDrugsTableHeader(doc, left, right, cols, y) {
    const rowH = 16;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    let x = left + 4;
    cols.forEach((c) => {
        doc.text(c.title, x, y + 3, { width: c.w - 8 });
        x += c.w;
    });
    y += rowH;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.5).stroke();
    return y;
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
    // Only keep a small bottom margin so rows fill the page (MRO/footer paginate themselves).
    const bottomLimit = () => doc.page.height - 48;

    y = drawDrugsTableHeader(doc, left, right, cols, y);

    parameters.forEach((p) => {
        if (y + rowH > bottomLimit()) {
            doc.addPage();
            y = 40;
            y = drawDrugsTableHeader(doc, left, right, cols, y);
        }
        const vals = [
            p.label || '—',
            p.value || '—',
            formatCutoff(p.screening_cutoff, p.unit_text),
            formatCutoff(p.confirmation_cutoff, p.unit_text),
        ];
        doc.font('Helvetica').fontSize(8).fillColor('#222');
        let x = left + 4;
        vals.forEach((v, i) => {
            doc.text(String(v), x, y + 3, { width: cols[i].w - 8 });
            x += cols[i].w;
        });
        y += rowH;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.5).stroke();
    });

    return y + 12;
}

function drawMroSection(doc, bundle, startY) {
    const { report, labTest } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;

    const mroFields = [
        { flag: 'show_final_result', label: 'Final Result :', value: report.final_result },
        { flag: 'show_test_remark', label: 'Remark :', value: report.test_remark },
        { flag: 'show_final_result_disposition', label: 'Final Result Disposition:', value: report.final_result_disposition },
        { flag: 'show_final_remark', label: 'Final Remark:', value: report.final_remark },
    ].filter((f) => showFlag(labTest, f.flag));

    if (mroFields.length === 0) return startY;

    let y = startY + 12;
    // Title + intro + fields + spacing — only break if this block won't fit.
    const mroNeeded = 22 + 34 + (mroFields.length * 16) + 24;
    if (y + mroNeeded > doc.page.height - 48) {
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

    mroFields.forEach((f) => {
        y = drawBoldInlineField(doc, left, y, f.label, f.value || '—', contentWidth);
    });

    return y + 16;
}

function drawAdditionalDetailsSection(doc, bundle, startY) {
    const { report, labTest } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;
    const mid = left + contentWidth / 2 + 10;

    const rows = [
        { flag: 'show_test_date', label: 'Date of Test:', value: formatUsDate(report.date_of_test) },
        { flag: 'show_fasting', label: 'Fasting:', value: report.fasting === '1' ? 'Yes' : report.fasting === '2' ? 'No' : report.fasting },
        { flag: 'show_requisition_no', label: 'Requisition No:', value: report.requisition_no },
        { flag: 'show_date_administered', label: 'Date Administered:', value: formatUsDate(report.date_administered) },
        { flag: 'show_applied_to', label: 'Applied To:', value: report.applied_to_arm },
        { flag: 'show_lot', label: 'Lot:', value: report.lot },
        { flag: 'show_expire_date', label: 'Exp. Date:', value: formatUsDate(report.expiry_date) },
        { flag: 'show_date_read', label: 'Date Read:', value: formatUsDate(report.date_read) },
        { flag: 'show_mm_indurations', label: 'mm Indurations:', value: report.mm_indurations },
        { flag: 'show_follow_up', label: 'Follow Up:', value: report.follow_up },
        { flag: 'show_device_identifier', label: 'Device Identifier:', value: report.device_identifier },
    ].filter((r) => showFlag(labTest, r.flag));

    if (rows.length === 0) return startY;

    let y = startY + 8;
    const detailsNeeded = 18 + Math.ceil(rows.length / 2) * 16 + 12;
    if (y + detailsNeeded > doc.page.height - 48) {
        doc.addPage();
        y = 40;
    }

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5f9e').text('Additional Details', left, y);
    y += 18;

    let yL = y;
    let yR = y;
    rows.forEach((row, index) => {
        if (index % 2 === 0) {
            yL = drawLabelValue(doc, left, yL, row.label, row.value || '—', 130);
        } else {
            yR = drawLabelValue(doc, mid, yR, row.label, row.value || '—', 130);
        }
    });

    return Math.max(yL, yR) + 12;
}

function drawReportFooter(doc, bundle, startY) {
    const { report, b2b, labTest } = bundle;
    const left = 40;
    const right = doc.page.width - 40;
    const contentWidth = right - left;
    let y = startY + 10;
    const footerNeeded = 18 + 34 + 22 + 14 + 14;
    if (y + footerNeeded > doc.page.height - 40) {
        doc.addPage();
        y = 40;
    }

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 18;

    const colW = contentWidth / 3;
    const officerName = b2b?.medical_officer_name || '—';
    const reportDate = (showFlag(labTest, 'show_reported_date') || showFlag(labTest, 'show_reported_time'))
        ? formatUsDateShort(report.reported_timestamp || new Date())
        : formatUsDateShort(new Date());
    const sigPath = bundle.sigPath;

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

async function generatePlainLabTestReportPdf(bundle) {
    const logoPath = await resolveReportLogoPath(bundle.b2b);
    const sigPath = await resolveUploadedFilePath(
        bundle.b2b?.medical_officer_signature_file_name,
        { prefix: PREFIX.b2bClients }
    );
    const assets = { ...bundle, logoPath, sigPath };

    return new Promise((resolve, reject) => {
        try {
            const { report, labTest } = assets;
            const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const pageWidth = doc.page.width;
            const left = 40;
            const right = pageWidth - 40;
            const contentWidth = right - left;
            const mid = left + contentWidth / 2 + 10;

            let y = drawReportHeader(doc, assets);

            const showSpecimen = showFlag(labTest, 'show_specimen');
            const showCollected = showFlag(labTest, 'show_collected_date') || showFlag(labTest, 'show_collected_time');
            const showReceived = showFlag(labTest, 'show_received_date') || showFlag(labTest, 'show_received_time');
            const showReported = showFlag(labTest, 'show_reported_date') || showFlag(labTest, 'show_reported_time');

            if (showSpecimen || showCollected || showReceived || showReported) {
                doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
                y += 16;

                let yL = y;
                let yR = y;

                if (showSpecimen) {
                    yL = drawLabelValue(doc, left, yL, 'Service and Specimen Type:', report.specimen_type_name || '—', 150);
                }
                if (showReceived) {
                    yL = drawLabelValue(doc, left, yL, 'Received Date/Time:', formatUsDateTime(report.received_timestamp), 150);
                }
                if (showCollected) {
                    yR = drawLabelValue(doc, mid, yR, 'Collection Date/Time:', formatUsDateTime(report.collected_timestamp), 140);
                }
                if (showReported) {
                    yR = drawLabelValue(doc, mid, yR, 'Reported Date/Time:', formatUsDateTime(report.reported_timestamp), 140);
                }
                y = Math.max(yL, yR) + 12;

                doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
                y += 16;
            } else {
                doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').lineWidth(0.5).stroke();
                y += 16;
            }

            // Patient demographics
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a5f9e').text('Patient/Donor', left, y);
            y += 20;
            let yL = y;
            let yR = y;
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

            y = drawAdditionalDetailsSection(doc, assets, y);
            y = drawDrugsTestedSection(doc, assets, y);
            y = drawMroSection(doc, assets, y);
            drawReportFooter(doc, assets, y);

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
async function buildLabTestReportPdf(reportId, { encrypt = true, authUser } = {}) {
    const bundle = await loadLabTestReportBundle(reportId);
    if (!bundle) {
        const err = new Error('Report not found');
        err.code = '404';
        throw err;
    }

    const patientB2b = bundle.b2bClientId || bundle.report.patient_b2b_client_id;
    const brandingLab = await resolveCertLabBranding(authUser, patientB2b);
    if (brandingLab) {
        bundle.b2b = brandingLab;
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
        lab: bundle.b2b,
    };
}

module.exports = {
    buildLabTestReportPdf,
    buildBirthdatePassword,
    loadLabTestReportBundle,
};
