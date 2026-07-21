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

/** Prefer logged-in lab field; otherwise Metro Lab fallback. */
function labOrFallback(labValue, fallback) {
    return textOrNull(labValue) || fallback;
}

/**
 * Resolve branding for the signed-in lab.
 * Used by download AND email so both PDFs match the preview.
 * Admin staff → b2b via admin_users.user_id; B2B portal → client id.
 * Falls back to Metro Lab when no lab row is found.
 */
async function resolveLoggedInLab(authUser) {
    if (!authUser || !authUser.id) return null;

    let b2bId = null;

    if (authUser.portal === 'b2b') {
        b2bId = authUser.id;
    } else {
        // admin portal, or older tokens without portal — try admin_users first
        const admin = await queryOne(
            'SELECT user_id FROM admin_users WHERE id = $1 AND deleted = false LIMIT 1',
            [authUser.id]
        );
        if (admin?.user_id) {
            b2bId = admin.user_id;
        } else if (authUser.portal !== 'admin') {
            // last resort: treat id as b2b client id
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

function isMale(sex) {
    return sex === 1 || sex === '1' || String(sex || '').toLowerCase() === 'male';
}

function isFemale(sex) {
    return sex === 2 || sex === '2' || String(sex || '').toLowerCase() === 'female';
}

function drawCheckbox(doc, x, y, checked) {
    doc.rect(x, y, 10, 10).lineWidth(1).strokeColor('#111').stroke();
    if (checked) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text('X', x + 1.5, y);
    }
}

function drawUnderlineField(doc, x, y, width, value) {
    const text = value ? String(value) : '';
    doc.moveTo(x, y + 11).lineTo(x + width, y + 11).strokeColor('#111').lineWidth(0.8).stroke();
    if (text) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
            .text(text, x + 2, y, { width: width - 4, align: 'center', lineBreak: false });
    }
}

async function buildAdultHealthCertPdf(id, options = {}) {
    const cert = await queryOne(
        `SELECT 
            ahc.*,
            p.name as patient_name, p.dob as patient_dob, p.gender as sex, p.mobile as tel, p.street1, p.street2,
            p.city, p.state, p.zipcode, p.email as patient_email
        FROM adult_health_certificates ahc
        LEFT JOIN patient p ON ahc.patient_id = p.id
        WHERE ahc.id = $1 AND ahc.deleted = false`,
        [id]
    );

    if (!cert) throw new Error('Certificate not found');

    // Logged-in lab branding (admin staff → b2b via user_id, or b2b portal). Metro Lab only if missing.
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
                        filename: `Adult_Health_Certificate_${cert.id}.pdf`,
                        password,
                    });
                } else {
                    resolve({ buffer: pdfBuffer, cert, filename: `Adult_Health_Certificate_${cert.id}.pdf` });
                }
            });

            // Layout matches the on-screen preview (same structure for download + email)
            const left = 44;
            const right = doc.page.width - 44;
            const pageW = right - left;
            let y = 32;

            const company = labOrFallback(lab?.company_name, FALLBACK.company);
            const address = labOrFallback(lab?.address, FALLBACK.addressShort);
            const phone = labOrFallback(lab?.public_phone_no, FALLBACK.phone);
            const fax = labOrFallback(lab?.public_fax, FALLBACK.fax);
            const email = labOrFallback(lab?.public_email, FALLBACK.email);
            const website = String(labOrFallback(lab?.website, FALLBACK.website)).replace(/^https?:\/\//i, '');
            const bannerAddress = labOrFallback(lab?.address, FALLBACK.addressLine);
            const hasLabLogo = Boolean(resolveUploadedImagePath(lab?.logo_file));
            const logoPath = resolveCertLogoPath(lab);

            // Watermark
            doc.save();
            doc.fillColor('#94a3b8', 0.08);
            doc.font('Helvetica-Bold').fontSize(58);
            doc.rotate(-28, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.text('METRO LAB', 80, doc.page.height / 2 - 18, { align: 'center', width: pageW + 40 });
            doc.restore();
            doc.fillColor('#111').opacity(1);

            // Banner logo + brand
            if (logoPath) {
                try {
                    doc.image(logoPath, left, y, { fit: [88, 64] });
                } catch (err) {
                    console.warn('Could not embed certificate logo:', err.message);
                }
            }

            const brandX = left + 102;
            if (!hasLabLogo) {
                doc.font('Helvetica-Bold').fontSize(26).fillColor('#1e293b')
                    .text('METRO', brandX, y + 4, { continued: true });
                doc.fillColor('#c9a227').text(' LAB');
            } else {
                doc.font('Helvetica-Bold').fontSize(16).fillColor('#111')
                    .text(company, brandX, y + 8, { width: pageW - 110 });
            }
            doc.font('Times-Roman').fontSize(9).fillColor('#111');
            doc.text(bannerAddress, brandX, y + 36, { width: pageW - 110 });
            doc.text(`Phone: ${phone} • Fax: ${fax} • ${email}`, brandX, y + 48, { width: pageW - 110 });
            y += 76;

            // Blue rules
            doc.moveTo(left, y).lineTo(right, y).strokeColor('#6c9cd4').lineWidth(2).stroke();
            y += 4;
            doc.moveTo(left, y).lineTo(right, y).strokeColor('#6c9cd4').lineWidth(1).stroke();
            y += 14;

            // Org block
            doc.font('Times-Bold').fontSize(12).fillColor('#111').text(company, left, y, { align: 'center', width: pageW });
            y += 15;
            doc.font('Times-Roman').fontSize(10);
            doc.text(address, left, y, { align: 'center', width: pageW });
            y += 13;
            doc.text(`(Tell) ${phone} (Fax) ${fax}`, left, y, { align: 'center', width: pageW });
            y += 13;
            doc.text(website, left, y, { align: 'center', width: pageW });
            y += 20;

            // Title
            doc.font('Times-Bold').fontSize(16).text('Adult Health Certificate', left, y, { align: 'center', width: pageW });
            y += 26;

            // Patient: Name + Sex
            doc.font('Times-Roman').fontSize(11);
            doc.text('Name:', left, y + 1);
            drawUnderlineField(doc, left + 42, y, 250, cert.patient_name);
            doc.font('Times-Roman').fontSize(11).text('Sex:', left + 310, y + 1);
            drawCheckbox(doc, left + 340, y + 1, isMale(cert.sex));
            doc.font('Times-Roman').fontSize(11).text('Male', left + 358, y + 1);
            drawCheckbox(doc, left + 408, y + 1, isFemale(cert.sex));
            doc.font('Times-Roman').fontSize(11).text('Female', left + 426, y + 1);
            y += 22;

            // DOB / Tel
            doc.font('Times-Roman').fontSize(11).text('DOB:', left, y + 1);
            drawUnderlineField(doc, left + 36, y, 160, formatUsDate(cert.patient_dob));
            doc.font('Times-Roman').fontSize(11).text('Tel #:', left + 220, y + 1);
            drawUnderlineField(doc, left + 256, y, 230, cert.tel);
            y += 22;

            // Address with guides
            doc.font('Times-Roman').fontSize(11).text('Address:', left, y + 1);
            const streetW = 145;
            const aptW = 90;
            const cityW = 90;
            const stateW = 55;
            const zipW = 70;
            let ax = left + 56;
            drawUnderlineField(doc, ax, y, streetW, cert.street1); ax += streetW + 6;
            drawUnderlineField(doc, ax, y, aptW, cert.street2); ax += aptW + 6;
            drawUnderlineField(doc, ax, y, cityW, cert.city); ax += cityW + 6;
            drawUnderlineField(doc, ax, y, stateW, cert.state); ax += stateW + 6;
            drawUnderlineField(doc, ax, y, zipW, cert.zipcode);
            y += 14;
            doc.font('Times-Roman').fontSize(7).fillColor('#555');
            ax = left + 56;
            doc.text('Street Name/Number', ax, y, { width: streetW, align: 'center' }); ax += streetW + 6;
            doc.text('Apt#(if applicable)', ax, y, { width: aptW, align: 'center' }); ax += aptW + 6;
            doc.text('City', ax, y, { width: cityW, align: 'center' }); ax += cityW + 6;
            doc.text('State', ax, y, { width: stateW, align: 'center' }); ax += stateW + 6;
            doc.text('Zip code', ax, y, { width: zipW, align: 'center' });
            y += 20;

            // Certify
            doc.fillColor('#111').font('Times-Roman').fontSize(11)
                .text('I have examined the above named person and certify that he/she is:', left, y);
            y += 18;

            drawCheckbox(doc, left + 18, y, !!cert.free_from_disease);
            doc.font('Times-Roman').fontSize(11)
                .text('1.', left, y)
                .text('Free from disease in communicable form.', left + 36, y);
            y += 18;

            drawCheckbox(doc, left + 18, y, !!cert.satisfactory_physical);
            doc.font('Times-Roman').fontSize(11).text('2.', left, y);
            doc.text(
                'In satisfactory physical condition, this will permit, close association with children/elderly without danger to them.',
                left + 36,
                y,
                { width: pageW - 36 }
            );
            y += 32;

            doc.font('Times-Roman').fontSize(11)
                .text('In addition to a general physical examination, the following test has been done:', left, y);
            y += 18;

            // Tuberculin
            doc.font('Times-Roman').fontSize(11).text('Tuberculin test (check one):', left, y + 1);
            drawCheckbox(doc, left + 168, y + 1, cert.tuberculin_test_type === 'Tine');
            doc.font('Times-Roman').fontSize(11).text('Tine', left + 186, y + 1);
            drawCheckbox(doc, left + 236, y + 1, cert.tuberculin_test_type === 'PPD');
            doc.font('Times-Roman').fontSize(11).text('PPD', left + 254, y + 1);
            y += 20;

            doc.font('Times-Roman').fontSize(11).text('Date planted:', left, y + 1);
            drawUnderlineField(doc, left + 78, y, 90, formatUsDate(cert.tuberculin_date_planted));
            doc.font('Times-Roman').fontSize(11).text('Date read:', left + 185, y + 1);
            drawUnderlineField(doc, left + 248, y, 90, formatUsDate(cert.tuberculin_date_read));
            doc.font('Times-Roman').fontSize(11).text('Result:', left + 350, y + 1);
            drawUnderlineField(doc, left + 392, y, 110, cert.tuberculin_result);
            y += 22;

            // Chest x-ray
            const hasXray = !!(cert.chest_xray_date || cert.chest_xray_result);
            drawCheckbox(doc, left, y + 1, hasXray);
            doc.font('Times-Roman').fontSize(11).text('Chest x-ray:', left + 18, y + 1);
            doc.text('Date:', left + 100, y + 1);
            drawUnderlineField(doc, left + 132, y, 100, formatUsDate(cert.chest_xray_date));
            doc.font('Times-Roman').fontSize(11).text('Result:', left + 250, y + 1);
            drawUnderlineField(doc, left + 292, y, 210, cert.chest_xray_result);
            y += 22;

            // Additional info
            drawCheckbox(doc, left, y + 1, !!cert.additional_info);
            doc.font('Times-Roman').fontSize(11)
                .text('Additional information, Past Medical History, Current Medications:', left + 18, y + 1);
            y += 18;
            doc.moveTo(left + 18, y + 14).lineTo(right, y + 14).strokeColor('#111').lineWidth(0.8).stroke();
            if (cert.additional_info) {
                doc.font('Helvetica').fontSize(10).text(String(cert.additional_info), left + 22, y, {
                    width: pageW - 28,
                    height: 14,
                    lineBreak: false,
                });
            }
            y += 32;

            // Signature
            doc.font('Times-Roman').fontSize(11).text('Name/ Signature of examining Clinician:', left, y + 1);
            const sigX = left + 220;
            const sigW = 200;
            const sigPath = resolveUploadedImagePath(lab?.medical_officer_signature_file_name);
            if (sigPath) {
                try {
                    doc.image(sigPath, sigX + 36, y - 16, { fit: [120, 32] });
                } catch (_) { /* ignore */ }
            }
            drawUnderlineField(doc, sigX, y, sigW, cert.clinician_name);
            const specialty = String(cert.clinician_specialty || '').toUpperCase();
            const specLabel = ['MD', 'PA', 'NP'].join('/');
            doc.font('Times-Roman').fontSize(11).text(specialty ? specLabel : 'MD/PA/NP', sigX + sigW + 8, y + 1);
            y += 24;

            doc.font('Times-Roman').fontSize(11).text('Date of examination:', left, y + 1);
            drawUnderlineField(doc, left + 124, y, 140, formatUsDate(cert.date_of_examination));
            y += 24;

            doc.font('Times-Roman').fontSize(11).text('Address:', left, y + 1);
            drawUnderlineField(doc, left + 56, y, pageW - 56, cert.clinician_address);

            // Footer
            doc.font('Times-Bold').fontSize(11)
                .text(website, left, doc.page.height - 40, { align: 'center', width: pageW });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    buildAdultHealthCertPdf,
};
