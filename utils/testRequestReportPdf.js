const PDFDocument = require('pdfkit');
const {
    resolveCertLabBranding,
    resolveCertLogoPath,
    drawCertBannerHeader,
    labText,
} = require('./certPdfCommon');

const PAGE_LEFT = 50;

function statusLabel(status) {
    if (status === false) return 'Rejected';
    if (status === true) return 'Processed';
    return 'Pending';
}

function formatEmployeeTests(emp) {
    const tests = [];
    if (emp.is_selected_for_drug) tests.push('Drug');
    if (emp.is_selected_for_alcohol) tests.push('Alcohol');
    if (emp.is_selected_for_alternate) tests.push('Alternate');
    return tests.length > 0 ? tests.join(', ') : 'None';
}

function drawRequestInfo(doc, tr, { left, right, y }) {
    const width = right - left;
    doc.font('Helvetica').fontSize(11).fillColor('#222');
    doc.text(`Request ID: TR-${tr.id}`, left, y, { width });
    y += 16;
    doc.text(`Date: ${new Date(tr.creation_timestamp).toLocaleString()}`, left, y, { width });
    y += 16;
    doc.text(`Corporate Name: ${tr.corporateClientCompany || tr.b2bClientCompany || 'N/A'}`, left, y, { width });
    y += 16;
    doc.text(`Title: ${tr.title || '—'}`, left, y, { width });
    y += 16;
    if (tr.year != null || tr.quarter != null) {
        doc.text(`Year: ${tr.year ?? '—'} | Quarter: ${tr.quarter ?? '—'}`, left, y, { width });
        y += 16;
    }
    if (tr.status !== undefined) {
        doc.text(`Status: ${statusLabel(tr.status)}`, left, y, { width });
        y += 16;
    }
    return y + 8;
}

function drawEmployeesSection(doc, employees, { left, right, y }) {
    const width = right - left;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
        .text('Assigned Employees', left, y, { width, underline: true });
    y += 22;

    if (!employees.length) {
        doc.font('Helvetica-Oblique').fontSize(11).fillColor('#555')
            .text('No employees found for this test request.', left, y, { width });
        return y + 20;
    }

    doc.font('Helvetica').fontSize(10).fillColor('#222');
    employees.forEach((emp, index) => {
        const name = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
        const dept = emp.department || 'No Department';
        doc.text(
            `${index + 1}. ${name} (${dept}) - Tests: ${formatEmployeeTests(emp)}`,
            left,
            y,
            { width }
        );
        y += 14;
    });
    return y;
}

function drawEmployeeSection(doc, emp, { left, right, y }) {
    const width = right - left;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
        .text('Employee Details', left, y, { width, underline: true });
    y += 22;

    doc.font('Helvetica').fontSize(11).fillColor('#222');
    doc.text(`Name: ${emp.first_name || ''} ${emp.last_name || ''}`.trim(), left, y, { width });
    y += 16;
    doc.text(`Department: ${emp.department || 'N/A'}`, left, y, { width });
    y += 16;
    doc.text(`Assigned Tests: ${formatEmployeeTests(emp)}`, left, y, { width });
    return y + 8;
}

/**
 * Build test request PDF with the same lab logo rules as health/physical certificates.
 * @param {{ tr: object, employees?: object[], employee?: object, authUser?: object }} opts
 */
async function buildTestRequestReportPdf({ tr, employees = [], employee = null, authUser = null }) {
    const lab = await resolveCertLabBranding(authUser, tr.b2b_client_id);
    const logoPath = await resolveCertLogoPath(lab);
    const hasLabLogo = Boolean(logoPath);
    const company = labText(lab?.company_name);
    const address = labText(lab?.address);
    const phone = labText(lab?.public_phone_no);
    const fax = labText(lab?.public_fax);
    const email = labText(lab?.public_email) || labText(lab?.email);

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: PAGE_LEFT, size: 'LETTER' });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve({ buffer: Buffer.concat(buffers), lab }));
            doc.on('error', reject);

            const right = doc.page.width - PAGE_LEFT;
            let y = drawCertBannerHeader(doc, {
                left: PAGE_LEFT,
                right,
                y: 36,
                logoPath,
                hasLabLogo,
                company,
                address,
                phone,
                fax,
                email,
            });

            const title = employee ? 'Test Request Report (Employee)' : 'Test Request Report';
            doc.font('Times-Bold').fontSize(16).fillColor('#111')
                .text(title, PAGE_LEFT, y, { width: right - PAGE_LEFT, align: 'center' });
            y += 28;

            y = drawRequestInfo(doc, tr, { left: PAGE_LEFT, right, y });

            if (employee) {
                drawEmployeeSection(doc, employee, { left: PAGE_LEFT, right, y });
            } else {
                drawEmployeesSection(doc, employees, { left: PAGE_LEFT, right, y });
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    buildTestRequestReportPdf,
};
