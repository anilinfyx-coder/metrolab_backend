const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const getEmailHeader = () => `
    <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://www.evmerp.com/assets/logo-DA7AtwHe.png" alt="Metrolab Logo" style="max-width: 200px; height: auto;" />
    </div>
`;

const sendMail = async (to, subject, htmlContent, attachments = []) => {
    try {
        const info = await transporter.sendMail({
            from: `"${process.env.SMTP_FROM_NAME || 'Metrolab'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
            to,
            subject,
            html: htmlContent,
            attachments
        });
        console.log("Message sent: %s", info.messageId);
        return true;
    } catch (error) {
        console.error("Error sending email: ", error);
        return false;
    }
};

const sendWelcomeB2BMail = async (to, companyName, password) => {
    const subject = "Welcome to Metrolab - Your Portal Credentials";
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${getEmailHeader()}
            <h2 style="color: #2c3e50; text-align: center; margin-top: 0;">Welcome to Metrolab</h2>
            <p>Dear ${companyName},</p>
            <p>Your Lab account has been successfully created. You can now log in to the Metrolab B2B Portal to manage your operations.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Login URL:</strong> <a href="/login">Metrolab B2B Portal</a></p>
                <p style="margin: 10px 0 0 0;"><strong>Username / Email:</strong> ${to}</p>
                <p style="margin: 10px 0 0 0;"><strong>Password:</strong> ${password}</p>
            </div>
            <p style="color: #e74c3c;"><em>Please change your password after logging in for the first time.</em></p>
            <br/>
            <p>Best Regards,</p>
            <p><strong>The Metrolab Team</strong></p>
        </div>
    `;
    return sendMail(to, subject, html);
};

const sendWelcomeCorporateMail = async (to, companyName, password) => {
    const subject = "Welcome to Metrolab - Your Corporate Portal Credentials";
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${getEmailHeader()}
            <h2 style="color: #2c3e50; text-align: center; margin-top: 0;">Welcome to Metrolab</h2>
            <p>Dear ${companyName},</p>
            <p>Your Corporate account has been successfully created. You can now log in to the Metrolab Corporate Portal to request tests and view reports.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Login URL:</strong> <a href="[Your_Corporate_Portal_URL]">Metrolab Corporate Portal</a></p>
                <p style="margin: 10px 0 0 0;"><strong>Username / Email:</strong> ${to}</p>
                <p style="margin: 10px 0 0 0;"><strong>Password:</strong> ${password}</p>
            </div>
            <p style="color: #e74c3c;"><em>Please change your password after logging in for the first time.</em></p>
            <br/>
            <p>Best Regards,</p>
            <p><strong>The Metrolab Team</strong></p>
        </div>
    `;
    return sendMail(to, subject, html);
};

const sendSubscriptionPurchaseMail = async (to, amount, startDate, endDate) => {
    const subject = "Subscription Confirmation - Metrolab";
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${getEmailHeader()}
            <h2 style="color: #27ae60; text-align: center; margin-top: 0;">Subscription Confirmed</h2>
            <p>Hello,</p>
            <p>Thank you for your purchase. Your subscription to Metrolab has been successfully updated.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Amount Paid:</strong> $${amount}</p>
                <p style="margin: 10px 0 0 0;"><strong>Valid From:</strong> ${new Date(startDate).toLocaleDateString()}</p>
                <p style="margin: 10px 0 0 0;"><strong>Valid Until:</strong> ${new Date(endDate).toLocaleDateString()}</p>
            </div>
            <p>We appreciate your business.</p>
            <br/>
            <p>Best Regards,</p>
            <p><strong>The Metrolab Team</strong></p>
        </div>
    `;
    return sendMail(to, subject, html);
};

const sendLabNotificationMail = async (to, labName, corporateName, title, count) => {
    const subject = "New Test Request Received";
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${getEmailHeader()}
            <h2 style="color: #2980b9; text-align: center; margin-top: 0;">New Test Request Notification</h2>
            <p>Dear ${labName},</p>
            <p>You have received a new test request (Random Selection / Bulk Request) from a corporate client.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Corporate Client:</strong> ${corporateName || 'N/A'}</p>
                <p style="margin: 10px 0 0 0;"><strong>Request Title:</strong> ${title}</p>
                <p style="margin: 10px 0 0 0;"><strong>Number of Employees:</strong> ${count}</p>
            </div>
            <p>Please log in to your B2B Portal to view the full details and process the request.</p>
            <br/>
            <p>Best Regards,</p>
            <p><strong>The Metrolab Team</strong></p>
        </div>
    `;
    return sendMail(to, subject, html);
};

const sendTestRequestEmployeeReportMail = async (to, employeeName, testTitle, pdfBuffer, pdfFilename) => {
    const subject = `Test Report: ${testTitle} - ${employeeName}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            ${getEmailHeader()}
            <h2 style="color: #2980b9; text-align: center; margin-top: 0;">Test Report Ready</h2>
            <p>Dear ${employeeName},</p>
            <p>Your test report for the request <strong>${testTitle}</strong> is attached to this email.</p>
            <p>Please find the PDF document attached.</p>
            <br/>
            <p>Best Regards,</p>
            <p><strong>The Metrolab Team</strong></p>
        </div>
    `;
    return sendMail(to, subject, html, [{ filename: pdfFilename, content: pdfBuffer }]);
};

module.exports = {
    sendWelcomeB2BMail,
    sendWelcomeCorporateMail,
    sendSubscriptionPurchaseMail,
    sendLabNotificationMail,
    sendTestRequestEmployeeReportMail
};
