const nodemailer = require('nodemailer');

let transporter;

// Only create transporter if email config is provided
if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT || 587,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
} else {
    // Mock transporter for development
    transporter = {
        sendMail: async (mailOptions) => {
            console.log('📧 [DEV MODE] Email would be sent to:', mailOptions.to);
            console.log('📧 [DEV MODE] Subject:', mailOptions.subject);
            console.log('📧 [DEV MODE] Token:', mailOptions.html);
            return { messageId: 'dev-mode' };
        }
    };
}

const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const sendVerificationEmail = async (email, token) => {
    const url = `${getFrontendUrl()}/verify?token=${token}`;
    await transporter.sendMail({
        to: email,
        subject: 'Verify your account',
        html: `Click <a href="${url}">here</a> to verify your account.`
    });
};

const sendPasswordResetEmail = async (email, token) => {
    const url = `${getFrontendUrl()}/reset-password?token=${token}`;
    await transporter.sendMail({
        to: email,
        subject: 'Reset your password',
        html: `Click <a href="${url}">here</a> to reset your password. This link expires in 1 hour.`
    });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };