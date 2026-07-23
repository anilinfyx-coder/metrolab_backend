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

    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).stroke('#d1d5db');
    y += 8;

    const isPercent = tr.selection_type === 2 || tr.selection_type === '2';
    const percentSuffix = isPercent ? '%' : '';

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#444');
    doc.text(
        `Drug Count: ${tr.drug_count || 0}${percentSuffix}   |   ` +
        `Alcohol Count: ${tr.alcohol_count || 0}${percentSuffix}   |   ` +
        `Alternate Count: ${tr.alternate_count || 0}`, 
        left, y
    );
    y += 14;
    doc.text(
        `Pool Employees: ${tr.total_count || 0}   |   ` +
        `Selected Employees: ${tr.total_selected_count || 0}`, 
        left, y
    );
    y += 16;

    return y + 4;
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

    const cols = {
        last: left,
        first: left + 90,
        dept: left + 180,
        drug: left + 270,
        alc: left + 350,
        alt: left + 430
    };

    const drawHeader = () => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111');
        doc.rect(left, y - 2, right - left, 16).fill('#f8f9fc');
        doc.fillColor('#111');
        doc.text('Last Name', cols.last, y + 2);
        doc.text('First Name', cols.first, y + 2);
        doc.text('Department', cols.dept, y + 2);
        doc.text('Drug', cols.drug, y + 2);
        doc.text('Alcohol', cols.alc, y + 2);
        doc.text('Alternate', cols.alt, y + 2);
        y += 16;
        doc.moveTo(left, y).lineTo(right, y).lineWidth(1).stroke('#d1d5db');
        y += 6;
    };

    drawHeader();

    employees.forEach((emp) => {
        if (y > doc.page.height - 60) {
            doc.addPage();
            y = 50;
            drawHeader();
        }

        doc.font('Helvetica').fontSize(9).fillColor('#222');
        const lastName = (emp.last_name || emp.lastName || '').trim();
        const firstName = (emp.first_name || emp.firstName || '').trim();
        const dept = emp.department || 'N/A';

        doc.text(lastName, cols.last, y, { width: 85, height: 12, ellipsis: true });
        doc.text(firstName, cols.first, y, { width: 85, height: 12, ellipsis: true });
        doc.text(dept, cols.dept, y, { width: 85, height: 12, ellipsis: true });

        const drawCheckboxStatus = (isSelected, submitStatus, x, textY) => {
            // Draw checkbox
            doc.lineWidth(1).strokeColor('#888').rect(x, textY - 1, 10, 10).stroke();
            
            if (isSelected) {
                // Draw checkmark inside box
                doc.lineWidth(1.5).strokeColor('#17a2b8');
                doc.moveTo(x + 2, textY + 4).lineTo(x + 4, textY + 7).lineTo(x + 8, textY + 2).stroke();
                
                // Print Done if submitted, otherwise leave blank (no 'Pend')
                if (submitStatus) {
                    doc.fillColor('#555').fontSize(8).text('Done', x + 15, textY + 1);
                }
            }
        };

        drawCheckboxStatus(emp.isSelectedForDrug || emp.is_selected_for_drug, emp.drugReportSubmitStatus, cols.drug, y);
        drawCheckboxStatus(emp.isSelectedForAlcohol || emp.is_selected_for_alcohol, emp.alcoholReportSubmitStatus, cols.alc, y);
        drawCheckboxStatus(emp.isSelectedForAlternate || emp.is_selected_for_alternate, false, cols.alt, y);

        y += 14;
        doc.moveTo(left, y - 2).lineTo(right, y - 2).lineWidth(0.5).stroke('#e5e7eb');
        y += 6;
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
