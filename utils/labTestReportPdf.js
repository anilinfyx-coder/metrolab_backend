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
    resolveLabLogoPath,
} = require('./uploadedFiles');
const { PREFIX } = require('./gcs');
const { buildEffectiveParamsCte, buildParameterValueLateralJoin } = require('./reportRequestParameters');
const { decryptPIIFields } = require('./cryptoUtils');
const {
    resolveCertLabBranding,
    resolveCertLogoPath,
    drawCertBannerHeader,
    labText,
} = require('./certPdfCommon');

function showFlag(labTest, flag) {
    return !!(labTest && labTest[flag]);
}

const FINAL_RESULT_CODE_MAP = {
    '1': 'Negative',
    '2': 'Positive',
    '3': 'Test Cancelled',
    '4': 'Refusal (Adulterated)',
    '5': 'Refusal (Substituted)',
    '6': 'Dilute',
};

function formatFinalResult(value) {
    if (value == null || value === '') return value;
    const raw = String(value).trim();
    return FINAL_RESULT_CODE_MAP[raw] || raw;
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

function formatAppliedToArm(value) {
    if (String(value) === '0') return 'Right Arm';
    if (String(value) === '1') return 'Left Arm';
    return value;
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

async function loadLabTestReportBundle(reportId, options = {}) {
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

    decryptPIIFields(report);

    let b2bClientId = null;
    if (options.authUser?.portal === 'b2b' && options.authUser.id) {
        b2bClientId = options.authUser.id;
    }

    if (!b2bClientId) {
        b2bClientId = await resolveOwnerB2bClientId({
            b2b_client_id: report.patient_b2b_client_id || report.waiting_list_b2b_client_id || report.b2b_client_id,
            waiting_list_id: report.waiting_list_id,
            patient_id: report.patient_id,
            corporate_client_id: report.corporate_client_id || report.waiting_list_corporate_client_id,
            lab_test_id: report.lab_test_id,
            created_by_id: report.created_by_id,
        });
    }

    const { labTest } = await resolveLabTestWithDisplayOptions(report.lab_test_id, {
        b2b_client_id: b2bClientId,
        waiting_list_id: report.waiting_list_id,
        patient_id: report.patient_id,
        corporate_client_id: report.corporate_client_id || report.waiting_list_corporate_client_id,
        lab_test_id: report.lab_test_id,
        created_by_id: report.created_by_id,
    });

    report.reason_for_test = report.reason_for_test || report.waiting_list_reason_for_test || null;

    const { resolveCertLabBranding } = require('./certPdfCommon');
    const b2b = await resolveCertLabBranding(options.authUser, b2bClientId, report.lab_test_id);

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
                    TRIM(COALESCE(v.value, '')) as value
             FROM effective_params rp
             ${buildParameterValueLateralJoin('$1', 'rp', 'v')}
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
                    TRIM(COALESCE(v.value, '')) as value
             FROM report_request_parameters rp
             ${buildParameterValueLateralJoin('$1', 'rp', 'v')}
             WHERE rp.lab_test_id = $2 AND rp.deleted = false
             ORDER BY rp.id ASC`,
            [reportId, report.lab_test_id],
        ));
    }

    const { rows: questions } = await query(
        `SELECT rq.id,
                rq.question_text as question,
                TRIM(COALESCE(a.value, '')) as answer
         FROM report_questions rq
         LEFT JOIN lab_test_category_report_question_answer a 
           ON a.report_questions_id = rq.id AND a.lab_test_category_report_id = $1
         WHERE rq.lab_test_id = $2 AND rq.deleted = false
         ORDER BY rq.id ASC`,
        [reportId, report.lab_test_id]
    );

    return { report, b2b, parameters, labTest, b2bClientId, questions };
}

async function resolveReportLogoPath(b2b) {
    // Use resolveLabLogoPath which handles GCS download, skips .webp,
    // and falls back to the default MetroLab logo when b2b has no logo.
    return resolveLabLogoPath(b2b);
}

/** Page layout constants — compact spacing + aligned columns to guarantee 1-page fit. */
const PAGE = {
    left: 40,
    rightMargin: 40,
    rowH: 14,
    sectionGap: 6,
    ruleGap: 6,
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
 * When a value wraps to 2+ lines, calculates the exact rendered height so
 * subsequent lines never overlap or clutter.
 */
function drawLabelValue(doc, x, y, label, value, labelWidth = 145, valueWidth = 135) {
    const text = value == null || value === '' ? '—' : String(value);
    const rawLabel = String(label || '').replace(/\s*:\s*$/, '');
    const colonX = x + labelWidth;
    const valueX = colonX + 6;
    const actualValW = Math.max(40, valueWidth - 6);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111')
        .text(rawLabel, x, y, { width: labelWidth - 2, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111')
        .text(':', colonX, y, { lineBreak: false });

    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    const valH = Math.ceil(doc.heightOfString(text, { width: actualValW, lineGap: 0.5 }));
    doc.text(text, valueX, y, {
        width: actualValW,
        lineBreak: true,
        lineGap: 0.5,
    });

    const rowAdvance = Math.max(PAGE.rowH, valH + 2);
    return y + rowAdvance;
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
    const leftLabelW = 132;
    const rightLabelW = 110;
    const leftValueW = mid - left - leftLabelW - 10;
    const rightValueW = right - mid - rightLabelW - 6;

    const company = labText(b2b?.company_name);
    const address = labText(b2b?.address);
    const phone = labText(b2b?.public_phone_no);
    const fax = labText(b2b?.public_fax);
    const email = labText(b2b?.public_email) || labText(b2b?.email);
    const hasLabLogo = Boolean(logoPath);

    let y = drawCertBannerHeader(doc, {
        left,
        right,
        y: 24,
        logoPath,
        hasLabLogo,
        company,
        address,
        phone,
        fax,
        email,
    });

    doc.font('Times-Bold').fontSize(15).fillColor('#111')
        .text(report.lab_test_name || 'Lab Test Report', left, y, { width: contentWidth, align: 'center' });
    y += 18;

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#222')
        .text(`Report Printed On: ${formatUsDateTime(new Date())}`, left, y, {
            width: contentWidth,
            align: 'right',
        });
    y += 11;
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
    const contentWidth = right - left;
    const mid = pageMid(doc);
    const leftLabelW = 132;
    const rightLabelW = 110;
    const leftValueW = mid - left - leftLabelW - 10;
    const rightValueW = right - mid - rightLabelW - 6;

    const showSpecimen = showFlag(labTest, 'show_specimen');
    const showCollected = showFlag(labTest, 'show_collected_date') || showFlag(labTest, 'show_collected_time');
    const showReceived = showFlag(labTest, 'show_received_date') || showFlag(labTest, 'show_received_time');
    const showReported = showFlag(labTest, 'show_reported_date') || showFlag(labTest, 'show_reported_time');

    if (!showSpecimen && !showCollected && !showReceived && !showReported) {
        return drawHRule(doc, left, right, startY, '#c0c0c0', 0.5) + PAGE.ruleGap;
    }

    let y = drawHRule(doc, left, right, startY, '#c0c0c0', 0.5) + PAGE.ruleGap;

    // Service and Specimen Type gets full width with same colon alignment as other left-side fields
    if (showSpecimen) {
        const fullValW = contentWidth - leftLabelW - 10;
        y = drawLabelValue(doc, left, y, 'Service and Specimen Type:', report.specimen_type_name || '—', leftLabelW, fullValW);
    }

    let yL = y;
    let yR = y;

    if (showReceived) {
        yL = drawLabelValue(doc, left, yL, 'Received Date/Time:', formatUsDateTime(report.received_timestamp), leftLabelW, leftValueW);
    }
    if (showCollected) {
        yR = drawLabelValue(doc, mid, yR, 'Collection Date/Time:', formatUsDateTime(report.collected_timestamp), rightLabelW, rightValueW);
    }
    if (showReported) {
        yR = drawLabelValue(doc, mid, yR, 'Reported Date/Time:', formatUsDateTime(report.reported_timestamp), rightLabelW, rightValueW);
    }

    y = Math.max(yL, yR) + 4;
    return drawHRule(doc, left, right, y, '#c0c0c0', 0.5) + PAGE.ruleGap;
}

function drawPatientSection(doc, bundle, startY) {
    const { report } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const mid = pageMid(doc);
    const leftLabelW = 132;
    const rightLabelW = 110;
    const leftValueW = mid - left - leftLabelW - 10;
    const rightValueW = right - mid - rightLabelW - 6;

    let yL = startY;
    let yR = startY;
    yL = drawLabelValue(doc, left, yL, 'Patient/Donor Name:', report.patient_name || '—', leftLabelW, leftValueW);
    yL = drawLabelValue(doc, left, yL, 'Patient/Donor Date Of Birth:', formatUsDate(report.patient_dob), leftLabelW, leftValueW);
    yL = drawLabelValue(doc, left, yL, 'Patient/Donor Phone No:', report.patient_mobile || '—', leftLabelW, leftValueW);

    // Address may wrap — colon still fixed before value; advance by real height.
    const addrRaw = 'Patient/Donor Address';
    const addrValue = buildPatientAddress(report);
    const colonX = left + leftLabelW;
    const addrValueX = colonX + 6;
    const addrValueW = Math.max(40, leftValueW - 6);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111')
        .text(addrRaw, left, yL, { width: leftLabelW - 2, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111')
        .text(':', colonX, yL, { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    const addrH = Math.max(PAGE.rowH, Math.ceil(doc.heightOfString(addrValue, { width: addrValueW })));
    doc.text(addrValue, addrValueX, yL, { width: addrValueW, lineGap: 0.5 });
    yL += addrH + 2;

    yR = drawLabelValue(doc, mid, yR, "Patient's SSN:", report.patient_ssn || '—', rightLabelW, rightValueW);
    yR = drawLabelValue(doc, mid, yR, 'Patient/Donor Age:', calcAge(report.patient_dob), rightLabelW, rightValueW);
    yR = drawLabelValue(doc, mid, yR, 'Patient/Donor Gender:', genderLabel(report.patient_gender), rightLabelW, rightValueW);

    const y = Math.max(yL, yR) + 4;
    return drawHRule(doc, left, right, y, '#c0c0c0', 0.5) + PAGE.ruleGap;
}

/**
 * Multi-line safe inline bold field: measures real wrapped height so remarks never overlap next rows.
 */
function drawBoldInlineField(doc, x, y, label, value, maxWidth = 532) {
    const textVal = value == null || value === '' ? '—' : String(value);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111');
    const labelW = doc.widthOfString(label + ' ');
    doc.text(label, x, y, { continued: false });

    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    const valX = x + labelW;
    const valW = Math.max(80, maxWidth - labelW);
    const valH = Math.ceil(doc.heightOfString(textVal, { width: valW }));
    doc.text(textVal, valX, y, { width: valW, lineGap: 1 });

    const rowAdvance = Math.max(PAGE.rowH, valH + 2);
    return y + rowAdvance;
}

function drawDrugsTableHeader(doc, left, right, cols, y) {
    const headerH = 19;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    let x = left + 3;
    cols.forEach((c) => {
        doc.text(c.title, x, y + 2, {
            width: c.w - 6,
            align: 'left',
            lineGap: 0.5,
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
    y += 4;
    const hasCutoffs = parameters.some((p) => {
        const sc = p.screening_cutoff;
        const cc = p.confirmation_cutoff;
        return (sc !== null && sc !== undefined && String(sc).trim() !== '' && String(sc).toLowerCase() !== 'null') ||
               (cc !== null && cc !== undefined && String(cc).trim() !== '' && String(cc).toLowerCase() !== 'null');
    });

    const tableHeading = hasCutoffs ? 'Drugs Tested' : (labTest?.name || 'Test Parameters');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text(tableHeading, left, y, { width: contentWidth, align: 'center' });
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 3;

    let cols;
    if (hasCutoffs) {
        const drugW = 205;
        const resultW = 75;
        const screenW = 125;
        const confirmW = contentWidth - drugW - resultW - screenW;
        cols = [
            { title: 'Drug Name', w: drugW },
            { title: 'Result', w: resultW },
            { title: 'Laboratory Screening Cutoff*', w: screenW },
            { title: 'Laboratory Confirmation\nCutoff*', w: confirmW },
        ];
    } else {
        const resultW = 120;
        const paramW = contentWidth - resultW;
        cols = [
            { title: 'Parameter Name', w: paramW },
            { title: 'Result', w: resultW },
        ];
    }

    // Adapt base row height based on number of parameters to guarantee 1-page fit
    const paramCount = parameters.length;
    const baseRowH = paramCount > 10 ? 14 : paramCount > 6 ? 16 : 18;
    const fontSize = paramCount > 10 ? 8 : 8.5;
    const bottomLimit = () => doc.page.height - 30;

    y = drawDrugsTableHeader(doc, left, right, cols, y);

    parameters.forEach((p) => {
        doc.font('Helvetica').fontSize(fontSize);
        const labelText = String(p.label || '—');
        const labelH = Math.ceil(doc.heightOfString(labelText, { width: cols[0].w - 6 }));
        const currentRowH = Math.max(baseRowH, labelH + 2);

        if (y + currentRowH > bottomLimit()) {
            doc.addPage();
            y = 30;
            y = drawDrugsTableHeader(doc, left, right, cols, y);
        }

        const vals = hasCutoffs
            ? [
                labelText,
                p.value || '—',
                formatCutoff(p.screening_cutoff, p.unit_text),
                formatCutoff(p.confirmation_cutoff, p.unit_text),
            ]
            : [
                labelText,
                p.value || '—',
            ];

        doc.font('Helvetica').fontSize(fontSize).fillColor('#111');
        let x = left + 3;
        const textY = y + 1;

        vals.forEach((v, i) => {
            if (i === 0) {
                // Drug / Parameter Name wraps smoothly if multi-word so it never cuts off
                doc.text(String(v), x, textY, {
                    width: cols[i].w - 6,
                    lineBreak: true,
                    lineGap: 0.5,
                });
            } else {
                doc.text(String(v), x, textY, {
                    width: cols[i].w - 6,
                    lineBreak: false,
                    ellipsis: true,
                });
            }
            x += cols[i].w;
        });

        y += currentRowH;
        doc.moveTo(left, y).lineTo(right, y).strokeColor('#dddddd').lineWidth(0.4).stroke();
    });

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(0.7).stroke();
    return y + PAGE.sectionGap;
}

function drawQuestionsSection(doc, bundle, startY) {
    const { questions } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;
    let y = startY;

    if (!questions || questions.length === 0) return startY;

    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text('Questions', left, y, { width: contentWidth, align: 'center' });
    y += 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#000').lineWidth(1).stroke();
    y += 3;

    const qW = contentWidth - 60;
    const aW = 60;
    const rowH = 15;
    const bottomLimit = () => doc.page.height - 30;

    questions.forEach((q) => {
        let displayAnswer = q.answer || '—';
        if (displayAnswer === '1') displayAnswer = 'Yes';
        if (displayAnswer === '0') displayAnswer = 'No';

        const textH = Math.ceil(doc.heightOfString(q.question || '—', { width: qW - 6 }));
        const needed = Math.max(rowH, textH + 3);

        if (y + needed > bottomLimit()) {
            doc.addPage();
            y = 30;
        }

        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111')
            .text(q.question || '—', left + 3, y + 1, {
                width: qW - 6,
                lineBreak: true,
            });

        doc.font('Helvetica').fontSize(8.5).fillColor('#111')
            .text(displayAnswer, left + qW + 3, y + 1, {
                width: aW - 6,
                lineBreak: false,
                ellipsis: true,
            });

        y += needed;
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
        { flag: 'show_final_result', label: 'Final Result:', value: formatFinalResult(report.final_result) },
        { flag: 'show_test_remark', label: 'Remark:', value: report.test_remark },
        { flag: 'show_final_result_disposition', label: 'Final Result Disposition:', value: formatFinalResult(report.final_result_disposition) },
        { flag: 'show_final_remark', label: 'Final Remark:', value: report.final_remark },
    ].filter((f) => showFlag(labTest, f.flag));

    if (mroFields.length === 0) return startY;

    let y = startY;
    const mroNeeded = 14 + 18 + (mroFields.length * PAGE.rowH) + 8;
    if (y + mroNeeded > doc.page.height - 30) {
        doc.addPage();
        y = 30;
    }

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
        .text('To Be Completed By Medical Review Officer', left, y, {
            width: contentWidth,
            align: 'center',
        });
    y += 12;

    doc.font('Helvetica').fontSize(8.5).fillColor('#111')
        .text(
            'I have reviewed the laboratory result for the specimen identified by this form in accordance with applicable federal requirements. My determination / verification is',
            left,
            y,
            { width: contentWidth, align: 'left', lineGap: 0.5 }
        );
    y += 18;

    const mroLabelW = 132;
    mroFields.forEach((f) => {
        y = drawLabelValue(doc, left, y, f.label, f.value || '—', mroLabelW, contentWidth - mroLabelW - 10);
    });

    return y + PAGE.sectionGap;
}

function drawAdditionalDetailsSection(doc, bundle, startY) {
    const { report, labTest } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;
    const mid = pageMid(doc);
    const leftLabelW = 132;
    const rightLabelW = 110;
    const leftValueW = mid - left - leftLabelW - 10;
    const rightValueW = right - mid - rightLabelW - 6;

    const allRows = [
        { flag: 'show_test_date', label: 'Date of Test:', value: formatUsDate(report.date_of_test) },
        { flag: 'show_fasting', label: 'Fasting:', value: report.fasting === '1' ? 'Yes' : report.fasting === '2' ? 'No' : report.fasting },
        { flag: 'show_requisition_no', label: 'Requisition No:', value: report.requisition_no },
        { flag: 'show_date_administered', label: 'Date Administered:', value: formatUsDate(report.date_administered) },
        { flag: 'show_applied_to', label: 'Applied To:', value: formatAppliedToArm(report.applied_to_arm) },
        { flag: 'show_lot', label: 'Lot:', value: report.lot },
        { flag: 'show_expire_date', label: 'Exp. Date:', value: formatUsDate(report.expiry_date) },
        { flag: 'show_date_read', label: 'Date Read:', value: formatUsDate(report.date_read) },
        { flag: 'show_mm_indurations', label: 'mm Indurations:', value: report.mm_indurations },
        { flag: 'show_device_identifier', label: 'Device Identifier:', value: report.device_identifier },
        { flag: 'show_follow_up', label: 'Follow Up:', value: report.follow_up, fullWidth: true },
    ].filter((r) => showFlag(labTest, r.flag));

    if (allRows.length === 0) return startY;

    let y = startY;
    if (y + 14 + Math.ceil(allRows.length / 2) * PAGE.rowH > doc.page.height - 30) {
        doc.addPage();
        y = 30;
    }

    const gridRows = allRows.filter((r) => !r.fullWidth);
    const fullRows = allRows.filter((r) => r.fullWidth);

    let yL = y;
    let yR = y;
    gridRows.forEach((row, index) => {
        if (index % 2 === 0) {
            yL = drawLabelValue(doc, left, yL, row.label, row.value || '—', leftLabelW, leftValueW);
        } else {
            yR = drawLabelValue(doc, mid, yR, row.label, row.value || '—', rightLabelW, rightValueW);
        }
    });

    y = Math.max(yL, yR);

    // Full-width rows (like Follow Up) get entire row width without cramping
    fullRows.forEach((row) => {
        y = drawLabelValue(doc, left, y, row.label, row.value || '—', leftLabelW, contentWidth - leftLabelW - 10);
    });

    y += 4;
    return drawHRule(doc, left, right, y, '#c0c0c0', 0.5) + PAGE.ruleGap;
}

function drawReportFooter(doc, bundle, startY) {
    const { report, b2b, labTest } = bundle;
    const left = PAGE.left;
    const right = pageRight(doc);
    const contentWidth = right - left;
    let y = startY;
    const footerNeeded = 52;

    if (y + footerNeeded > doc.page.height - 24) {
        doc.addPage();
        y = 30;
    }

    y = drawHRule(doc, left, right, y, '#c0c0c0', 0.7) + 6;

    const colW = contentWidth / 3;
    const officerName = b2b?.medical_officer_name || '—';
    const reportDate = (showFlag(labTest, 'show_reported_date') || showFlag(labTest, 'show_reported_time'))
        ? formatUsDateShort(report.reported_timestamp || new Date())
        : formatUsDateShort(new Date());
    const sigPath = bundle.sigPath;

    const valueY = y;
    const labelY = y + 22;

    doc.font('Helvetica').fontSize(9).fillColor('#111')
        .text(officerName, left, valueY, { width: colW, align: 'center' });

    if (sigPath && !sigPath.toLowerCase().endsWith('.webp')) {
        try {
            doc.image(sigPath, left + colW + (colW - 100) / 2, valueY - 2, { fit: [100, 22] });
        } catch (err) {
            console.warn('Could not embed medical officer signature:', err.message);
        }
    }

    doc.font('Helvetica').fontSize(9).fillColor('#111')
        .text(reportDate, left + colW * 2, valueY, { width: colW, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111')
        .text("Medical Review Officer's Name", left, labelY, { width: colW, align: 'center' });
    doc.text('Signature of Medical Review Officer', left + colW, labelY, { width: colW, align: 'center' });
    doc.text('Date (MM/DD/YY)', left + colW * 2, labelY, { width: colW, align: 'center' });

    y = labelY + 11;
    y = drawHRule(doc, left, right, y, '#c0c0c0', 0.7) + 4;

    const hasCutoffs = bundle.parameters?.some((p) => {
        const sc = p.screening_cutoff;
        const cc = p.confirmation_cutoff;
        return (sc !== null && sc !== undefined && String(sc).trim() !== '' && String(sc).toLowerCase() !== 'null') ||
               (cc !== null && cc !== undefined && String(cc).trim() !== '' && String(cc).toLowerCase() !== 'null');
    });

    if (hasCutoffs) {
        doc.font('Helvetica').fontSize(7.5).fillColor('#111')
            .text('* Represents laboratory screening and confirmation values', left, y, {
                width: contentWidth,
                align: 'left',
            });
    }

    return y + 4;
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
            const doc = new PDFDocument({ margin: 32, size: 'LETTER' });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            let y = drawReportHeader(doc, assets);
            y = drawSpecimenSection(doc, assets, y);
            y = drawPatientSection(doc, assets, y);
            y = drawAdditionalDetailsSection(doc, assets, y);
            y = drawQuestionsSection(doc, assets, y);
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
    const bundle = await loadLabTestReportBundle(reportId, { authUser });
    if (!bundle) {
        const err = new Error('Report not found');
        err.code = '404';
        throw err;
    }

    const testName = (bundle.labTest?.name || bundle.labTest?.test_name || bundle.report?.lab_test_name || '').toLowerCase();
    
    // Intercept custom certificates
    if (testName === 'adult health certificate (tb)') {
        const customCert = await queryOne(`SELECT id FROM adult_health_certificates WHERE waiting_list_id = $1 AND lab_test_id = $2 LIMIT 1`, [bundle.report.waiting_list_id, bundle.report.lab_test_id]);
        if (customCert) {
            const { buildAdultHealthCertForDelivery } = require('./certPdfDelivery');
            const pdfData = await buildAdultHealthCertForDelivery(customCert.id, authUser);
            // Re-encrypt since it expects { buffer, filename, password, report... }
            const password = buildBirthdatePassword(bundle.report.patient_dob);
            let buffer = pdfData.buffer;
            if (encrypt && password) buffer = encryptPdfBuffer(buffer, password);
            return {
                buffer,
                filename: `${bundle.report.uid || `Report-${bundle.report.id}`}.pdf`,
                password: encrypt ? password : null,
                report: bundle.report,
                b2b: bundle.b2b,
                lab: bundle.b2b,
            };
        }
    } else if (testName === 'physical examination certificate') {
        const customCert = await queryOne(`SELECT id FROM physical_examination_certificates WHERE waiting_list_id = $1 AND lab_test_id = $2 LIMIT 1`, [bundle.report.waiting_list_id, bundle.report.lab_test_id]);
        if (customCert) {
            const { buildPhysicalExamCertForDelivery } = require('./certPdfDelivery');
            const pdfData = await buildPhysicalExamCertForDelivery(customCert.id, authUser);
            const password = buildBirthdatePassword(bundle.report.patient_dob);
            let buffer = pdfData.buffer;
            if (encrypt && password) buffer = encryptPdfBuffer(buffer, password);
            return {
                buffer,
                filename: `${bundle.report.uid || `Report-${bundle.report.id}`}.pdf`,
                password: encrypt ? password : null,
                report: bundle.report,
                b2b: bundle.b2b,
                lab: bundle.b2b,
            };
        }
    }

    const patientB2b = bundle.b2bClientId || bundle.report.patient_b2b_client_id;
    const brandingLab = await resolveCertLabBranding(authUser, patientB2b, bundle.report.lab_test_id);
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
    generatePlainLabTestReportPdf,
};
