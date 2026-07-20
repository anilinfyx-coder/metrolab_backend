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

async function buildPhysicalExamCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT 
            pec.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel, p.street1, p.street2,
            p.city, p.state, p.zipcode, p.email as patient_email,
            b2b.company_name as b2b_company_name, b2b.logo_file as b2b_logo,
            b2b.address as b2b_address, b2b.public_phone_no as b2b_phone,
            b2b.public_fax as b2b_fax, b2b.public_email as b2b_email, b2b.website as b2b_website,
            b2b.medical_officer_signature_file_name as b2b_signature
        FROM physical_examination_certificates pec
        LEFT JOIN patient p ON pec.patient_id = p.id
        LEFT JOIN b2b_clients b2b ON p.b2b_client_id = b2b.id
        WHERE pec.id = $1 AND pec.deleted = false`,
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
                    resolve({ buffer: encryptedBuffer, cert, filename: `Physical_Exam_Certificate_${cert.id}.pdf`, password });
                } else {
                    resolve({ buffer: pdfBuffer, cert, filename: `Physical_Exam_Certificate_${cert.id}.pdf` });
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
                
                return y + 30;
            };

            let cy = drawHeader();

            // TITLE
            doc.fontSize(16).font('Times-Bold').text('Physical Examination Certificate', { align: 'center', underline: true });
            cy += 30;

            doc.fontSize(10).font('Times-Roman');
            const fullAddress = [cert.street1, cert.street2, cert.city, cert.state, cert.zipcode].filter(Boolean).join(', ');
            const sexStr = cert.sex == 1 ? 'Male' : cert.sex == 2 ? 'Female' : cert.sex;

            // Row 1
            doc.text(`Name: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${cert.patient_name || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Age: `, { continued: true }).font('Times-Bold').text(`  ${cert.age || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Sex: `, { continued: true }).font('Times-Bold').text(`  ${sexStr || ''}  `, { underline: true });
            cy += 20;

            // Row 2
            doc.font('Times-Roman').text(`Address: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${fullAddress || '                                '}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Tel #: `, { continued: true }).font('Times-Bold').text(`  ${cert.tel || ''}  `, { underline: true });
            cy += 20;

            // Row 3
            doc.font('Times-Roman').text(`Height: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${cert.height || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Weight: `, { continued: true }).font('Times-Bold').text(`  ${cert.weight || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        B.P: `, { continued: true }).font('Times-Bold').text(`  ${cert.bp || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Pulse: `, { continued: true }).font('Times-Bold').text(`  ${cert.pulse || ''}  `, { underline: true });
            cy += 20;

            // Row 4
            doc.font('Times-Roman').text(`Hearing:   Right `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${cert.hearing_right || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Left `, { continued: true }).font('Times-Bold').text(`  ${cert.hearing_left || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`          Vision:   Right `, { continued: true }).font('Times-Bold').text(`  ${cert.vision_right || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Left `, { continued: true }).font('Times-Bold').text(`  ${cert.vision_left || ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`          Wear Glasses `, { continued: true }).font('Times-Bold').text(`  ${cert.wear_glasses ? 'Yes' : 'No'}  `, { underline: true });
            cy += 30;

            // Table Header
            doc.font('Times-Bold').text('CLINICAL EVALUATION', 50, cy);
            doc.text('NORMAL', 250, cy);
            doc.text('ABNORMAL', 330, cy);
            cy += 20;
            
            doc.font('Times-Roman');
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

            items.forEach((item) => {
                doc.text(item.id, 50, cy);
                doc.text(item.label, 80, cy);
                
                if (item.field === 'Normal') {
                    doc.text('X', 260, cy);
                } else if (item.field === 'Abnormal') {
                    doc.text('X', 350, cy);
                }
                cy += 15;
            });
            
            cy += 10;
            doc.text('13.', 50, cy);
            doc.text('Additional Comment, Past medical history, current medications:', 80, cy);
            cy += 15;
            doc.font('Times-Bold').text(`  ${cert.additional_comments || '                                                                                            '}  `, 80, cy, { underline: true });
            cy += 25;

            doc.font('Times-Roman');
            doc.text('14.', 50, cy);
            doc.text('Overall Physical Condition', 80, cy, { continued: true });
            doc.text(`        Fit `, { continued: true }).font('Times-Bold').text(`  ${cert.overall_condition === 'Fit' ? 'X' : ''}  `, { underline: true, continued: true })
               .font('Times-Roman').text(`        Unfit `, { continued: true }).font('Times-Bold').text(`  ${cert.overall_condition === 'Unfit' ? 'X' : ''}  `, { underline: true });
            cy += 30;

            // SIGNATURE
            doc.font('Times-Roman').text(`Name/Signature of examining Clinician: `, 50, cy, { continued: true });
            
            if (cert.b2b_signature) {
                const sigPath = path.join(__dirname, '..', 'uploads', cert.b2b_signature);
                if (fs.existsSync(sigPath)) {
                    doc.image(sigPath, 250, cy - 20, { height: 30 });
                    doc.text(`                              ${cert.clinician_specialty || 'MD/PA/NP'}`, 250, cy);
                } else {
                    doc.font('Times-Bold').text(`  ${cert.clinician_name || ''}  `, { underline: true, continued: true }).font('Times-Roman').text(` ${cert.clinician_specialty || 'MD/PA/NP'}`);
                }
            } else {
                 doc.font('Times-Bold').text(`  ${cert.clinician_name || ''}  `, { underline: true, continued: true }).font('Times-Roman').text(` ${cert.clinician_specialty || 'MD/PA/NP'}`);
            }
            cy += 20;

            doc.font('Times-Roman').text(`Date of examination: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${formatUsDate(cert.date_of_examination)}  `, { underline: true });
            cy += 20;

            doc.font('Times-Roman').text(`Address: `, 50, cy, { continued: true }).font('Times-Bold').text(`  ${cert.clinician_address || '                    '}  `, { underline: true });
            cy += 40;
            
            doc.font('Helvetica-Bold').fontSize(10).text(cert.b2b_website || 'www.metrolabdc.com', { align: 'center' });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    buildPhysicalExamCertPdf
};
