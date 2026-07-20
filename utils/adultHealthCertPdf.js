const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const muhammara = require('muhammara');
const { queryOne } = require('../db');

function pad(n) {
    return String(n).padStart(2, '0');
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

async function buildAdultHealthCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT 
            ahc.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel, p.street1, p.street2,
            p.city, p.state, p.zipcode, p.email as patient_email,
            b2b.company_name as b2b_company_name, b2b.logo_file as b2b_logo,
            b2b.address as b2b_address, b2b.public_phone_no as b2b_phone,
            b2b.public_fax as b2b_fax, b2b.public_email as b2b_email, b2b.website as b2b_website,
            b2b.medical_officer_signature_file_name as b2b_signature
        FROM adult_health_certificates ahc
        LEFT JOIN patient p ON ahc.patient_id = p.id
        LEFT JOIN b2b_clients b2b ON p.b2b_client_id = b2b.id
        WHERE ahc.id = $1 AND ahc.deleted = false`,
        [id]
    );

    if (!cert) throw new Error("Certificate not found");

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                let password = null;
                if (options.encrypt) {
                    password = buildBirthdatePassword(cert.patient_dob);
                    if (!password) {
                        return reject(new Error("Cannot encrypt: patient DOB is invalid"));
                    }
                    const encryptedBuffer = encryptPdfBuffer(pdfBuffer, password);
                    resolve({ buffer: encryptedBuffer, cert, filename: `Adult_Health_Certificate_${cert.id}.pdf`, password });
                } else {
                    resolve({ buffer: pdfBuffer, cert, filename: `Adult_Health_Certificate_${cert.id}.pdf` });
                }
            });

            // HEADER
            const drawHeader = () => {
                let y = 50;
                
                // Draw logo if exists
                if (cert.b2b_logo) {
                    const logoPath = path.join(__dirname, '..', 'uploads', cert.b2b_logo);
                    if (fs.existsSync(logoPath)) {
                        doc.image(logoPath, doc.page.width / 2 - 50, y, { height: 60, align: 'center' });
                    }
                    y += 70;
                } else {
                    const logoPath = path.join(__dirname, '..', 'uploads', 'metrolablogo.png');
                    if (fs.existsSync(logoPath)) {
                        doc.image(logoPath, doc.page.width / 2 - 100, y, { height: 60 });
                    }
                    doc.fontSize(24).font('Helvetica-Bold').fillColor('#333').text('METRO LAB', doc.page.width / 2, y + 20);
                    y += 70;
                }
                
                doc.fontSize(10).font('Helvetica').fillColor('#000');
                doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#6c9cd4').lineWidth(2).stroke();
                y += 5;
                doc.text(cert.b2b_address || '3422 Georgia Avenue NW • Washington, D.C. 20010', { align: 'center' });
                doc.text(`Phone: ${cert.b2b_phone || '202.234.1234'} • Fax: ${cert.b2b_fax || '202.234.1339'} • ${cert.b2b_email || 'manager@metrolabdc.com'}`, { align: 'center' });
                y += 25;
                doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke();
                y += 10;
                
                doc.fontSize(16).font('Helvetica-Bold').text(cert.b2b_company_name || 'Metro Lab & Clinic LLC', { align: 'center' });
                doc.fontSize(11).font('Helvetica');
                doc.text(cert.b2b_address || '3422 Georgia Ave NW Washington DC 20010', { align: 'center' });
                doc.text(`(Tell) ${cert.b2b_phone || '202-234-1234'} (Fax) ${cert.b2b_fax || '202-234-1339'}`, { align: 'center' });
                doc.text(cert.b2b_website || 'www.metrolabdc.com', { align: 'center' });
                
                return y + 40;
            };

            let cy = drawHeader();

            // TITLE
            doc.fontSize(16).font('Times-Bold').text('Adult Health Certificate', { align: 'center', underline: true });
            cy += 40;

            doc.fontSize(12).font('Times-Roman');

            const fullAddress = [cert.street1, cert.street2, cert.city, cert.state, cert.zipcode].filter(Boolean).join(', ');
            const sexStr = cert.sex == 1 ? 'Male' : cert.sex == 2 ? 'Female' : cert.sex;

            // PATIENT INFO
            doc.text(`Name: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${cert.patient_name || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Sex: `, { continued: true }).font('Times-Bold').text(`  ${sexStr || ''}  `, { underline: true });
            cy += 20;

            doc.font('Times-Roman').text(`DOB: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${formatUsDate(cert.patient_dob)}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Tel #: `, { continued: true }).font('Times-Bold').text(`  ${cert.tel || ''}  `, { underline: true });
            cy += 20;

            doc.font('Times-Roman').text(`Address: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${fullAddress || '                                '}  `, { underline: true });
            cy += 40;

            // BODY
            const drawCheckbox = (x, y, checked) => {
                doc.rect(x, y, 10, 10).lineWidth(1).strokeColor('#000').stroke();
                if (checked) {
                    doc.font('Helvetica-Bold').fontSize(10).text('X', x + 2, y + 1);
                }
                doc.font('Times-Roman').fontSize(12);
            };

            drawCheckbox(70, cy, cert.free_from_disease);
            doc.text('Free from communicable diseases.', 90, cy);
            cy += 25;

            drawCheckbox(70, cy, cert.satisfactory_physical);
            doc.text('In satisfactory physical condition.', 90, cy);
            cy += 35;

            doc.text(`Tuberculin test (check one): `, 90, cy);
            doc.font('Times-Bold').text(`  ${cert.tuberculin_test_type === 'Tine' ? 'X' : ''}  `, 250, cy, { underline: true });
            doc.font('Times-Roman').text(` Tine`, 280, cy);
            doc.font('Times-Bold').text(`  ${cert.tuberculin_test_type === 'PPD' ? 'X' : ''}  `, 330, cy, { underline: true });
            doc.font('Times-Roman').text(` PPD`, 360, cy);
            cy += 25;

            doc.text(`Date planted: `, 90, cy, { continued: true }).font('Times-Bold').text(`  ${formatUsDate(cert.tuberculin_date_planted)}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Date read: `, { continued: true }).font('Times-Bold').text(`  ${formatUsDate(cert.tuberculin_date_read)}  `, { underline: true });
            cy += 25;

            doc.font('Times-Roman').text(`Result: `, 90, cy, { continued: true }).font('Times-Bold').text(`  ${cert.tuberculin_result || '                                '}  `, { underline: true });
            cy += 35;

            doc.font('Times-Roman').text(`Chest x-ray:`, 90, cy);
            cy += 25;

            doc.text(`Date: `, 110, cy, { continued: true }).font('Times-Bold').text(`  ${formatUsDate(cert.chest_xray_date)}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Result: `, { continued: true }).font('Times-Bold').text(`  ${cert.chest_xray_result || '                    '}  `, { underline: true });
            cy += 35;

            doc.font('Times-Roman').text(`Additional information:`, 50, cy);
            cy += 20;
            doc.font('Times-Bold').text(`${cert.additional_info || ' '}`, 50, cy, { underline: true });
            cy += 40;

            // SIGNATURE
            doc.font('Times-Roman').text(`Name/Signature: `, 50, cy, { continued: true });
            
            if (cert.b2b_signature) {
                const sigPath = path.join(__dirname, '..', 'uploads', cert.b2b_signature);
                if (fs.existsSync(sigPath)) {
                    doc.image(sigPath, 140, cy - 20, { height: 30 });
                    doc.text(`                              ${cert.clinician_specialty || 'MD/PA/NP'}`, 140, cy);
                } else {
                    doc.font('Times-Bold').text(`  ${cert.clinician_name || ''}  `, { underline: true, continued: true }).font('Times-Roman').text(` ${cert.clinician_specialty || 'MD/PA/NP'}`);
                }
            } else {
                 doc.font('Times-Bold').text(`  ${cert.clinician_name || ''}  `, { underline: true, continued: true }).font('Times-Roman').text(` ${cert.clinician_specialty || 'MD/PA/NP'}`);
            }
            
            doc.text(`Address: `, 350, cy, { continued: true }).font('Times-Bold').text(`  ${cert.clinician_address || '                    '}  `, { underline: true });
            cy += 25;

            doc.font('Times-Roman').text(`Date: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${formatUsDate(cert.date_of_examination)}  `, { underline: true });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    buildAdultHealthCertPdf
};
