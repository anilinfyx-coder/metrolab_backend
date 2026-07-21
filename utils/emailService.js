const nodemailer = require('nodemailer');
require('dotenv').config();
const { buildEmailBranding } = require('./emailBranding');
const { getLoginUrl } = require('./frontendUrl');

function buildLoginLinkBlock(portalLabel = 'Portal') {
    const loginUrl = getLoginUrl();
    return `
            <div style="text-align: center; margin: 24px 0;">
                <a href="${loginUrl}" style="display: inline-block; background-color: #0076A3; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Log In to ${portalLabel}
                </a>
            </div>`;
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_PORT == 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const sendMail = async (to, subject, htmlContent, attachments = [], lab = null) => {
    try {
        const branding = await buildEmailBranding(lab);
        const allAttachments = branding.logoAttachment
            ? [branding.logoAttachment, ...attachments]
            : attachments;

        const info = await transporter.sendMail({
            from: `"${process.env.SMTP_FROM_NAME || branding.companyName}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
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
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2c3e50; text-align: center; margin-top: 0;">Welcome to ${branding.companyName}</h2>
            <p>Dear ${companyName},</p>
            <p>Your Lab account has been successfully created. You can now log in to the B2B Portal to manage your operations.</p>
            ${buildLoginLinkBlock('B2B Portal')}
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Username / Email:</strong> ${to}</p>
                <p style="margin: 10px 0 0 0;"><strong>Password:</strong> ${password}</p>
            </div>
            <p style="color: #e74c3c;"><em>Please change your password after logging in for the first time.</em></p>
            <br/>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [], lab);
};

const sendWelcomeCorporateMail = async (to, companyName, password, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Welcome to ${branding.companyName} - Your Corporate Portal Credentials`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2c3e50; text-align: center; margin-top: 0;">Welcome to ${branding.companyName}</h2>
            <p>Dear ${companyName},</p>
            <p>Your Corporate account has been successfully created. You can now log in to the Corporate Portal to request tests and view reports.</p>
            ${buildLoginLinkBlock('Corporate Portal')}
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Username / Email:</strong> ${to}</p>
                <p style="margin: 10px 0 0 0;"><strong>Password:</strong> ${password}</p>
            </div>
            <p style="color: #e74c3c;"><em>Please change your password after logging in for the first time.</em></p>
            <br/>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [], lab);
};

const sendSubscriptionPurchaseMail = async (to, companyName, amount, startDate, endDate, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Subscription Confirmation - ${branding.companyName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #27ae60; text-align: center; margin-top: 0;">Subscription Confirmed</h2>
            <p>Dear ${companyName || branding.companyName},</p>
            <p>Thank you for your purchase. Your subscription with <strong>${branding.companyName}</strong> has been successfully activated.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Amount Paid:</strong> $${amount}</p>
                <p style="margin: 10px 0 0 0;"><strong>Valid From:</strong> ${new Date(startDate).toLocaleDateString()}</p>
                <p style="margin: 10px 0 0 0;"><strong>Valid Until:</strong> ${new Date(endDate).toLocaleDateString()}</p>
            </div>
            <p>We appreciate your business.</p>
            <br/>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [], lab);
};

const sendWalletRechargeMail = async (to, companyName, amount, newBalance, description, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Wallet Funds Added - ${branding.companyName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #27ae60; text-align: center; margin-top: 0;">Wallet Recharged Successfully</h2>
            <p>Dear ${companyName || branding.companyName},</p>
            <p>Funds have been added to your wallet with <strong>${branding.companyName}</strong>.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Amount Added:</strong> $${amount}</p>
                <p style="margin: 10px 0 0 0;"><strong>New Balance:</strong> $${newBalance}</p>
                ${description ? `<p style="margin: 10px 0 0 0;"><strong>Description:</strong> ${description}</p>` : ''}
            </div>
            <p>You can use your wallet balance to book lab tests.</p>
            <br/>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [], lab);
};

const sendLabNotificationMail = async (to, labName, corporateName, title, count, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `New Test Request Received - ${branding.companyName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2980b9; text-align: center; margin-top: 0;">New Test Request Notification</h2>
            <p>Dear ${labName || branding.companyName},</p>
            <p>You have received a new test request (Random Selection / Bulk Request) from a corporate client.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Corporate Client:</strong> ${corporateName || 'N/A'}</p>
                <p style="margin: 10px 0 0 0;"><strong>Request Title:</strong> ${title}</p>
                <p style="margin: 10px 0 0 0;"><strong>Number of Employees:</strong> ${count}</p>
            </div>
            <p>Please log in to your B2B Portal to view the full details and process the request.</p>
            <br/>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [], lab);
};

const sendTestRequestEmployeeReportMail = async (to, employeeName, testTitle, pdfBuffer, pdfFilename, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Test Report: ${testTitle} - ${employeeName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2980b9; text-align: center; margin-top: 0;">Test Report Ready</h2>
            <p>Dear ${employeeName},</p>
            <p>Your test report for the request <strong>${testTitle}</strong> is attached to this email.</p>
            <p>Please find the PDF document attached.</p>
            <br/>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [{ filename: pdfFilename, content: pdfBuffer }], lab);
};

const sendLabTestCategoryReportMail = async (to, patientName, testName, reportUid, pdfBuffer, pdfFilename, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Lab Test Report: ${testName || 'Report'} (${reportUid || ''})`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2980b9; text-align: center; margin-top: 0;">Your Lab Test Report</h2>
            <p>Dear ${patientName || 'Patient'},</p>
            <p>Please find your lab test report attached to this email.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Test:</strong> ${testName || '—'}</p>
                <p style="margin: 10px 0 0 0;"><strong>Report UID:</strong> ${reportUid || '—'}</p>
            </div>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
    }], lab);
};

const sendCertificateMail = async (to, patientName, certType, pdfBuffer, pdfFilename, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Your ${certType}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2980b9; text-align: center; margin-top: 0;">Your Certificate</h2>
            <p>Dear ${patientName || 'Patient'},</p>
            <p>Please find your <strong>${certType}</strong> attached to this email.</p>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
    return sendMail(to, subject, html, [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
    }], lab);
};

const sendPasswordResetMail = async (to, displayName, resetUrl, lab = null) => {
    const branding = await buildEmailBranding(lab);
    const subject = `Reset Your Password - ${branding.companyName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${branding.headerHtml}
            <h2 style="color: #2c3e50; text-align: center; margin-top: 0;">Reset Your Password</h2>
            <p>Dear ${displayName || 'User'},</p>
            <p>We received a request to reset the password for your <strong>${branding.companyName}</strong> account.</p>
            <p>Click the button below to choose a new password. This link will expire in <strong>1 hour</strong>.</p>
            <div style="text-align: center; margin: 28px 0;">
                <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0076A3; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Reset Password
                </a>
            </div>
            <p style="font-size: 13px; color: #666; word-break: break-all; line-height: 1.5;">
                If the button does not open the page (common with Gmail on localhost), copy and paste this link into your browser:<br/>
                <a href="${resetUrl}" style="color: #0076A3;">${resetUrl}</a>
            </p>
            <div style="background-color: #fff8e6; padding: 15px; border-radius: 5px; margin: 20px 0; border: 1px solid #f0e0b2;">
                <p style="margin: 0; color: #8a6d1d;"><strong>Security tip:</strong></p>
                <p style="margin: 8px 0 0 0; font-size: 13px; color: #666;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
            </div>
            <p>Best Regards,</p>
            ${branding.signatureHtml}
        </div>
    `;
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
};
