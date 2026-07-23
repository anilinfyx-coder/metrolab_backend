const nodemailer = require('nodemailer');
const dns = require('dns');
// Force IPv4 first to prevent local ETIMEDOUT errors on broken IPv6 networks
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
require('dotenv').config();
const { buildEmailBranding } = require('./emailBranding');
const { getLoginUrl } = require('./frontendUrl');
const {
    escapeHtml,
    buildPrimaryButton,
    buildInfoBox,
    buildAlertBox,
    buildParagraph,
    buildGreeting,
    buildBrandedEmail,
} = require('./emailTemplates');

const createTransporter = (lab) => {
    if (lab && lab.smtp_server && lab.smtp_port && lab.smtp_email && lab.smtp_password) {
        return nodemailer.createTransport({
            host: lab.smtp_server,
            port: Number(lab.smtp_port),
            secure: Number(lab.smtp_port) === 465,
            auth: {
                user: lab.smtp_email,
                pass: lab.smtp_password,
            },
        });
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_PORT == 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
};

const verifySmtpCredentials = async (host, port, user, pass) => {
    const testTransporter = nodemailer.createTransport({
        host: host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: {
            user: user,
            pass: pass,
        },
    });
    try {
        await testTransporter.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
};

const sendMail = async (to, subject, htmlContent, attachments = [], lab = null) => {
    try {
        const branding = await buildEmailBranding(lab);
        const allAttachments = branding.logoAttachment
            ? [branding.logoAttachment, ...attachments]
            : attachments;

        const transporter = createTransporter(lab);
        
        let fromName = process.env.SMTP_FROM_NAME || branding.companyName;
        let fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
        
        if (lab && lab.smtp_server && lab.smtp_email) {
            fromName = branding.companyName;
            fromEmail = lab.smtp_email;
        }

        const info = await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            html: htmlContent,
            attachments: allAttachments,
        });
        console.log('Message sent: %s', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending email: ', error);
        return false;
    }
};

const sendWelcomeB2BMail = async (to, companyName, password, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Welcome to ${branding.companyName} - Your Portal Credentials`;
    const bodyHtml = [
        buildGreeting(companyName),
        buildParagraph('Your Lab account has been successfully created. You can now log in to the B2B Portal to manage your operations.'),
        buildPrimaryButton('Log In to B2B Portal', getLoginUrl(lab?.custom_domain)),
        buildInfoBox([
            { label: 'Username / Email', value: to },
            { label: 'Password', value: password },
        ]),
        buildAlertBox('Please change your password after logging in for the first time.', { title: 'Important', variant: 'warning' }),
    ].join('');
    const { html } = await buildBrandedEmail({ lab, title: `Welcome to ${branding.companyName}`, bodyHtml });
    return sendMail(to, subject, html, [], lab);
};

const sendWelcomeCorporateMail = async (to, companyName, password, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Welcome to ${branding.companyName} - Your Corporate Portal Credentials`;
    const bodyHtml = [
        buildGreeting(companyName),
        buildParagraph('Your Corporate account has been successfully created. You can now log in to the Corporate Portal to request tests and view reports.'),
        buildPrimaryButton('Log In to Corporate Portal', getLoginUrl(lab?.custom_domain)),
        buildInfoBox([
            { label: 'Username / Email', value: to },
            { label: 'Password', value: password },
        ]),
        buildAlertBox('Please change your password after logging in for the first time.', { title: 'Important', variant: 'warning' }),
    ].join('');
    const { html } = await buildBrandedEmail({ lab, title: `Welcome to ${branding.companyName}`, bodyHtml });
    return sendMail(to, subject, html, [], lab);
};

const sendSubscriptionPurchaseMail = async (to, companyName, amount, startDate, endDate, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Subscription Confirmation - ${branding.companyName}`;
    const bodyHtml = [
        buildGreeting(companyName || branding.companyName),
        buildParagraph(`Thank you for your purchase. Your subscription with <strong>${escapeHtml(branding.companyName)}</strong> has been successfully activated.`),
        buildInfoBox([
            { label: 'Amount Paid', value: `$${amount}` },
            { label: 'Valid From', value: new Date(startDate).toLocaleDateString() },
            { label: 'Valid Until', value: new Date(endDate).toLocaleDateString() },
        ]),
        buildParagraph('We appreciate your business.'),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'Subscription Confirmed',
        titleColor: '#15803d',
        bodyHtml,
    });
    return sendMail(to, subject, html, [], lab);
};

const sendWalletRechargeMail = async (to, companyName, amount, newBalance, description, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Wallet Funds Added - ${branding.companyName}`;
    const infoRows = [
        { label: 'Amount Added', value: `$${amount}` },
        { label: 'New Balance', value: `$${newBalance}` },
    ];
    if (description) infoRows.push({ label: 'Description', value: description });
    const bodyHtml = [
        buildGreeting(companyName || branding.companyName),
        buildParagraph(`Funds have been added to your wallet with <strong>${escapeHtml(branding.companyName)}</strong>.`),
        buildInfoBox(infoRows),
        buildParagraph('You can use your wallet balance to book lab tests.'),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'Wallet Recharged Successfully',
        titleColor: '#15803d',
        bodyHtml,
    });
    return sendMail(to, subject, html, [], lab);
};

const sendLabNotificationMail = async (to, labName, corporateName, title, count, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `New Test Request Received - ${branding.companyName}`;
    const bodyHtml = [
        buildGreeting(labName || branding.companyName),
        buildParagraph('You have received a new test request (Random Selection / Bulk Request) from a corporate client.'),
        buildInfoBox([
            { label: 'Corporate Client', value: corporateName || 'N/A' },
            { label: 'Request Title', value: title },
            { label: 'Number of Employees', value: String(count) },
        ]),
        buildParagraph('Please log in to your B2B Portal to view the full details and process the request.'),
        buildPrimaryButton('Open B2B Portal', getLoginUrl(lab?.custom_domain)),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'New Test Request Notification',
        titleColor: '#1d4ed8',
        bodyHtml,
    });
    return sendMail(to, subject, html, [], lab);
};

const sendTestRequestEmployeeReportMail = async (to, employeeName, testTitle, pdfBuffer, pdfFilename, lab = null) => {
    const subject = `Test Report: ${testTitle} - ${employeeName}`;
    const bodyHtml = [
        buildGreeting(employeeName),
        buildParagraph(`Your test report for the request <strong>${escapeHtml(testTitle)}</strong> is attached to this email.`),
        buildParagraph('Please find the PDF document attached.'),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'Test Report Ready',
        titleColor: '#1d4ed8',
        bodyHtml,
    });
    return sendMail(to, subject, html, [{ filename: pdfFilename, content: pdfBuffer }], lab);
};

const sendLabTestCategoryReportMail = async (to, patientName, testName, reportUid, pdfBuffer, pdfFilename, lab = null) => {
    const subject = `Lab Test Report: ${testName || 'Report'} (${reportUid || ''})`;
    const bodyHtml = [
        buildGreeting(patientName || 'Patient'),
        buildParagraph('Please find your lab test report attached to this email.'),
        buildInfoBox([
            { label: 'Test', value: testName || '—' },
            { label: 'Report UID', value: reportUid || '—' },
        ]),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'Your Lab Test Report',
        titleColor: '#1d4ed8',
        bodyHtml,
    });
    return sendMail(to, subject, html, [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
    }], lab);
};

const sendCertificateMail = async (to, patientName, certType, pdfBuffer, pdfFilename, lab = null) => {
    const subject = `Your ${certType}`;
    const bodyHtml = [
        buildGreeting(patientName || 'Patient'),
        buildParagraph(`Please find your <strong>${escapeHtml(certType)}</strong> attached to this email.`),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'Your Certificate',
        titleColor: '#1d4ed8',
        bodyHtml,
    });
    return sendMail(to, subject, html, [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
    }], lab);
};

const sendPasswordResetMail = async (to, displayName, resetUrl, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Reset Your Password - ${branding.companyName}`;
    const bodyHtml = [
        buildGreeting(displayName || 'User'),
        buildParagraph(`We received a request to reset the password for your <strong>${escapeHtml(branding.companyName)}</strong> account.`),
        buildParagraph('Click the button below to choose a new password. This link will expire in <strong>1 hour</strong>.'),
        buildPrimaryButton('Reset Password', resetUrl),
        buildParagraph(
            `If the button does not open the page, copy and paste this link into your browser:<br/>`
            + `<a href="${resetUrl}" style="color: #0f766e; word-break: break-all;">${escapeHtml(resetUrl)}</a>`
        ),
        buildAlertBox(
            'If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.',
            { title: 'Security tip', variant: 'warning' }
        ),
    ].join('');
    const { html } = await buildBrandedEmail({
        lab,
        title: 'Reset Your Password',
        bodyHtml,
    });
    return sendMail(to, subject, html, [], lab);
};

module.exports = {
    sendMail,
    sendWelcomeCorporateMail,
    sendSubscriptionPurchaseMail,
    sendWalletRechargeMail,
    sendWelcomeB2BMail,
    sendLabNotificationMail,
    sendTestRequestEmployeeReportMail,
    sendLabTestCategoryReportMail,
    sendCertificateMail,
    sendPasswordResetMail,
    verifySmtpCredentials,
};
