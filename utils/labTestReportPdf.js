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
const { buildEffectiveParamsCte } = require('./reportRequestParameters');
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

function buildPatientAddress(report) {
    const parts = [];
    if (report.patient_street1) parts.push(String(report.patient_street1).trim());
    if (report.patient_street2) parts.push(String(report.patient_street2).trim());
    if (report.patient_city) parts.push(String(report.patient_city).trim());
    if (report.patient_state) parts.push(String(report.patient_state).trim());
    if (report.patient_zipcode) parts.push(`ZipCode: ${String(report.patient_zipcode).trim()}`);
    return parts.filter(Boolean).join(', ') || '—';
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

    let parameters;
    if (b2bClientId) {
        const { sql: effectiveCte, values: effectiveValues } = buildEffectiveParamsCte(
            b2bClientId,
            report.lab_test_id,
            2,
        );
        const paramParams = [reportId, ...effectiveValues];
        ({ rows: parameters } = await query(
            `WITH ${effectiveCte}
             SELECT rp.id,
                    COALESCE(rp.label, rp.name) as label,
                    rp.screening_cutoff,
                    rp.confirmation_cutoff,
                    rp.unit_text,
                    COALESCE(v.value, '') as value
             FROM effective_params rp
             LEFT JOIN lab_test_category_report_request_parameter_value v
               ON v.report_request_parameters_id = rp.id
              AND v.lab_test_category_report_id = $1
              AND v.deleted = false
             WHERE rp.status IS DISTINCT FROM false
             ORDER BY rp.id ASC`,
            paramParams,
        ));
    } else {
        ({ rows: parameters } = await query(
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
            [reportId, report.lab_test_id],
        ));
    }

    return { report, b2b, parameters, labTest, b2bClientId };
}

async function resolveReportLogoPath(b2b) {
    return resolveCertLogoPath(b2b);
}

/** Page layout constants — even spacing + aligned columns. */
const PAGE = {
    left: 44,
    rightMargin: 44,
    rowH: 16,
    sectionGap: 12,
    ruleGap: 10,
};

function pageRight(doc) {
    return doc.page.width - PAGE.rightMargin;
}

function pageMid(doc) {
    const left = PAGE.left;
    const right = pageRight(doc);
    return left + (right - left) / 2 + 6;
}

/**
 * Bold label + ":" + value.
 * Colon is always drawn at a fixed X (end of label column), so every value
 * starts in the same vertical line with ":" immediately before it.
 */
function drawLabelValue(doc, x, y, label, value, labelWidth = 150, valueWidth = 140) {
    const text = value == null || value === '' ? '—' : String(value);
    const rawLabel = String(label || '').replace(/\s*:\s*$/, '');
    const colonX = x + labelWidth;
    const valueX = colonX + 8;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
        .text(rawLabel, x, y, { width: labelWidth - 2, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
        .text(':', colonX, y, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#111')
        .text(text, valueX, y, {
            width: Math.max(40, valueWidth - 8),
            lineBreak: false,
            ellipsis: true,
        });
    return y + PAGE.rowH;
}

function drawHRule(doc, left, right, y, color = '#c0c0c0', width = 0.6) {
    doc.moveTo(left, y).lineTo(right, y).strokeColor(color).lineWidth(width).stroke();
    return y;
}

/**
 * Lab report brand header — same visual UI as health/physical certificates
 * (logo left, company details right, double blue rule). Field data stays LTCR-style.
 */
function drawReportHeader(doc, bundle) {
    const { report, b2b, labTest, logoPath } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;
    const mid = pageMid(doc);
    const leftLabelW = 155;
    const rightLabelW = 120;
    const leftValueW = mid - left - leftLabelW - 12;
    const rightValueW = right - mid - rightLabelW - 8;

    const company = labText(b2b?.company_name);
    const address = labText(b2b?.address);
    const phone = labText(b2b?.public_phone_no);
    const fax = labText(b2b?.public_fax);
    const email = labText(b2b?.public_email) || labText(b2b?.email);
    const hasLabLogo = Boolean(logoPath);

    let y = drawCertBannerHeader(doc, {
        left,
        right,
        y: 30,
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
    y += 24;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222')
        .text(`Report Printed On: ${formatUsDateTime(new Date())}`, left, y, {
            width: contentWidth,
            align: 'right',
        });
    y += 14;
    y = drawHRule(doc, left, right, y, '#000', 0.9) + PAGE.ruleGap;

    let yL = y;
    let yR = y;

    yL = drawLabelValue(doc, left, yL, 'UID:', `#${report.uid || report.id}`, leftLabelW, leftValueW);
    if (showFlag(labTest, 'show_test_performed_by')) {
        yL = drawLabelValue(doc, left, yL, 'Test Performed by:', report.test_performed_by || '—', leftLabelW, leftValueW);
    }
    yL = drawLabelValue(doc, left, yL, 'Medical Officer:', b2b?.medical_officer_name || '—', leftLabelW, leftValueW);
    if (labText(b2b?.clia_number)) {
        yL = drawLabelValue(doc, left, yL, 'CLIA No.:', labText(b2b.clia_number), leftLabelW, leftValueW);
    }

    if (showFlag(labTest, 'show_reason_for_test')) {
        yR = drawLabelValue(doc, mid, yR, 'Reason for Test:', report.reason_for_test || '—', rightLabelW, rightValueW);
    }
    if (showFlag(labTest, 'show_report_status')) {
        yR = drawLabelValue(doc, mid, yR, 'Reported Status:', report.report_status || '—', rightLabelW, rightValueW);
    }
    if (showFlag(labTest, 'show_regulation')) {
        yR = drawLabelValue(doc, mid, yR, 'Regulation:', report.regulation || '—', rightLabelW, rightValueW);
    }
    if (labText(b2b?.mrocc)) {
        yR = drawLabelValue(doc, mid, yR, 'MROCC:', labText(b2b.mrocc), rightLabelW, rightValueW);
    }

    return Math.max(yL, yR) + PAGE.sectionGap;
}

function drawSpecimenSection(doc, bundle, startY) {
    const { report, labTest } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const mid = pageMid(doc);
    const leftLabelW = 155;
    const rightLabelW = 135;
    const leftValueW = mid - left - leftLabelW - 12;
    const rightValueW = right - mid - rightLabelW - 8;

    const showSpecimen = showFlag(labTest, 'show_specimen');
    const showCollected = showFlag(labTest, 'show_collected_date') || showFlag(labTest, 'show_collected_time');
    const showReceived = showFlag(labTest, 'show_received_date') || showFlag(labTest, 'show_received_time');
    const showReported = showFlag(labTest, 'show_reported_date') || showFlag(labTest, 'show_reported_time');

    if (!showSpecimen && !showCollected && !showReceived && !showReported) {
        return drawHRule(doc, left, right, startY, '#c0c0c0', 0.5) + PAGE.ruleGap;
    }

    let y = drawHRule(doc, left, right, startY, '#c0c0c0', 0.5) + PAGE.ruleGap;
    let yL = y;
    let yR = y;

    if (showSpecimen) {
        yL = drawLabelValue(doc, left, yL, 'Service and Specimen Type:', report.specimen_type_name || '—', leftLabelW, leftValueW);
    }
    if (showReceived) {
        yL = drawLabelValue(doc, left, yL, 'Received Date/Time:', formatUsDateTime(report.received_timestamp), leftLabelW, leftValueW);
    }
    if (showCollected) {
        yR = drawLabelValue(doc, mid, yR, 'Collection Date/Time:', formatUsDateTime(report.collected_timestamp), rightLabelW, rightValueW);
    }
    if (showReported) {
        yR = drawLabelValue(doc, mid, yR, 'Reported Date/Time:', formatUsDateTime(report.reported_timestamp), rightLabelW, rightValueW);
    }

    y = Math.max(yL, yR) + 6;
    return drawHRule(doc, left, right, y, '#c0c0c0', 0.5) + PAGE.ruleGap;
}

function drawPatientSection(doc, bundle, startY) {
    const { report } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const mid = pageMid(doc);
    const leftLabelW = 155;
    const rightLabelW = 120;
    const leftValueW = mid - left - leftLabelW - 12;
    const rightValueW = right - mid - rightLabelW - 8;

    let yL = startY;
    let yR = startY;
    yL = drawLabelValue(doc, left, yL, 'Patient/Donor Name:', report.patient_name || '—', leftLabelW, leftValueW);
    yL = drawLabelValue(doc, left, yL, 'Patient/Donor Date Of Birth:', formatUsDate(report.patient_dob), leftLabelW, leftValueW);
    yL = drawLabelValue(doc, left, yL, 'Patient/Donor Phone No:', report.patient_mobile || '—', leftLabelW, leftValueW);

    // Address may wrap — colon still fixed before value; advance by real height.
    const addrRaw = 'Patient/Donor Address';
    const addrValue = buildPatientAddress(report);
    const colonX = left + leftLabelW;
    const addrValueX = colonX + 8;
    const addrValueW = Math.max(40, leftValueW - 8);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
        .text(addrRaw, left, yL, { width: leftLabelW - 2, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111')
        .text(':', colonX, yL, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#111');
    const addrH = Math.max(PAGE.rowH, Math.ceil(doc.heightOfString(addrValue, { width: addrValueW })));
    doc.text(addrValue, addrValueX, yL, { width: addrValueW });
    yL += addrH + 2;

    yR = drawLabelValue(doc, mid, yR, "Patient's SSN:", report.patient_ssn || '—', rightLabelW, rightValueW);
    yR = drawLabelValue(doc, mid, yR, 'Patient/Donor Age:', calcAge(report.patient_dob), rightLabelW, rightValueW);
    yR = drawLabelValue(doc, mid, yR, 'Patient/Donor Gender:', genderLabel(report.patient_gender), rightLabelW, rightValueW);

    const y = Math.max(yL, yR) + 8;
    return drawHRule(doc, left, right, y, '#c0c0c0', 0.5) + PAGE.ruleGap;
}

function drawBoldInlineField(doc, x, y, label, value) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(label, x, y, { continued: true });
    doc.font('Helvetica').fontSize(9).fillColor('#111').text(` ${value || '—'}`);
    return y + PAGE.rowH;
}

function drawDrugsTableHeader(doc, left, right, cols, y) {
    // Tall enough for 2-line cutoff headers — prevents overlap with first data row.
    const headerH = 30;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    let x = left + 3;
    cols.forEach((c) => {
        doc.text(c.title, x, y + 3, {
            width: c.w - 6,
            align: 'left',
            lineGap: 1,
        });
        x += c.w;
    });
    y += headerH;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.7).stroke();
    return y;
}

function drawDrugsTestedSection(doc, bundle, startY) {
    const { parameters } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;
    let y = startY;

    if (!parameters || parameters.length === 0) return startY;

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 9;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
        .text('Drugs Tested', left, y, { width: contentWidth, align: 'center' });
    y += 15;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 6;

    // Match LTCR reference proportions: Drug → Result close-ish, then a wider
    // Result column (gap before cutoffs), then Screening / Confirmation closer together.
    const drugW = 155;
    const resultW = 110;
    const screenW = 130;
    const confirmW = contentWidth - drugW - resultW - screenW;
    const cols = [
        { title: 'Drug Name', w: drugW },
        { title: 'Result', w: resultW },
        { title: 'Laboratory Screening Cutoff*', w: screenW },
        { title: 'Laboratory Confirmation\nCutoff*', w: confirmW },
    ];
    const rowH = 22;
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
        doc.font('Helvetica').fontSize(9).fillColor('#111');
        let x = left + 3;
        const textY = y + Math.floor((rowH - 10) / 2);
        vals.forEach((v, i) => {
            doc.text(String(v), x, textY, {
                width: cols[i].w - 6,
                lineBreak: false,
                ellipsis: true,
            });
            x += cols[i].w;
        });
        y += rowH;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#dddddd').lineWidth(0.4).stroke();
    });

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.7).stroke();
    return y + PAGE.sectionGap;
}

function drawMroSection(doc, bundle, startY) {
    const { report, labTest } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;

    const mroFields = [
        { flag: 'show_final_result', label: 'Final Result :', value: report.final_result },
        { flag: 'show_test_remark', label: 'Remark :', value: report.test_remark },
        { flag: 'show_final_result_disposition', label: 'Final Result Disposition:', value: report.final_result_disposition },
        { flag: 'show_final_remark', label: 'Final Remark:', value: report.final_remark },
    ].filter((f) => showFlag(labTest, f.flag));

    if (mroFields.length === 0) return startY;

    let y = startY;
    const mroNeeded = 22 + 36 + (mroFields.length * PAGE.rowH) + 20;
    if (y + mroNeeded > doc.page.height - 48) {
        doc.addPage();
        y = 40;
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111')
        .text('To Be Completed By Medical Review Officer', left, y, {
            width: contentWidth,
            align: 'center',
        });
    y += 18;

    doc.font('Helvetica').fontSize(9).fillColor('#111')
        .text(
            'I have reviewed the laboratory result for the specimen identified by this form in accordance with applicable federal requirements. My determination / verification is',
            left,
            y,
            { width: contentWidth, align: 'left', lineGap: 2 }
        );
    y += 32;

    mroFields.forEach((f) => {
        y = drawBoldInlineField(doc, left, y, f.label, f.value || '—');
    });

    return y + PAGE.sectionGap;
}

function drawAdditionalDetailsSection(doc, bundle, startY) {
    const { report, labTest } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const mid = pageMid(doc);
    const labelW = 130;
    const leftValueW = mid - left - labelW - 10;
    const rightValueW = right - mid - labelW - 6;

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

    let y = startY;
    if (y + 18 + Math.ceil(rows.length / 2) * PAGE.rowH > doc.page.height - 48) {
        doc.addPage();
        y = 40;
    }

    let yL = y;
    let yR = y;
    rows.forEach((row, index) => {
        if (index % 2 === 0) {
            yL = drawLabelValue(doc, left, yL, row.label, row.value || '—', labelW, leftValueW);
        } else {
            yR = drawLabelValue(doc, mid, yR, row.label, row.value || '—', labelW, rightValueW);
        }
    });

    y = Math.max(yL, yR) + 6;
    return drawHRule(doc, left, right, y, '#c0c0c0', 0.5) + PAGE.ruleGap;
}

function drawReportFooter(doc, bundle, startY) {
    const { report, b2b, labTest } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;
    let y = startY;
    const footerNeeded = 88;

    if (y + footerNeeded > doc.page.height - 40) {
        doc.addPage();
        y = 48;
    }

    y = drawHRule(doc, left, right, y, '#c0c0c0', 0.7) + 14;

    const colW = contentWidth / 3;
    const officerName = b2b?.medical_officer_name || '—';
    const reportDate = (showFlag(labTest, 'show_reported_date') || showFlag(labTest, 'show_reported_time'))
        ? formatUsDateShort(report.reported_timestamp || new Date())
        : formatUsDateShort(new Date());
    const sigPath = bundle.sigPath;

    const valueY = y;
    const labelY = y + 34;

    doc.font('Helvetica').fontSize(10).fillColor('#111')
        .text(officerName, left, valueY, { width: colW, align: 'center' });

    if (sigPath && !sigPath.toLowerCase().endsWith('.webp')) {
        try {
            doc.image(sigPath, left + colW + (colW - 120) / 2, valueY - 2, { fit: [120, 30] });
        } catch (err) {
            console.warn('Could not embed medical officer signature:', err.message);
        }
    }

    doc.font('Helvetica').fontSize(10).fillColor('#111')
        .text(reportDate, left + colW * 2, valueY, { width: colW, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111')
        .text("Medical Review Officer's Name", left, labelY, { width: colW, align: 'center' });
    doc.text('Signature of Medical Review Officer', left + colW, labelY, { width: colW, align: 'center' });
    doc.text('Date (MM/DD/YY)', left + colW * 2, labelY, { width: colW, align: 'center' });

    y = labelY + 16;
    y = drawHRule(doc, left, right, y, '#c0c0c0', 0.7) + 10;

    doc.font('Helvetica').fontSize(8).fillColor('#111')
        .text('* Represents laboratory screening and confirmation values', left, y, {
            width: contentWidth,
            align: 'left',
        });

    return y + 10;
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
            const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            let y = drawReportHeader(doc, assets);
            y = drawSpecimenSection(doc, assets, y);
            y = drawPatientSection(doc, assets, y);
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
