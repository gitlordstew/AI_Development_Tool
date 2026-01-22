const nodemailer = require('nodemailer');

function isMailerConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function getTransport() {
  const port = Number.parseInt(process.env.SMTP_PORT || '0', 10) || 587;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendMail({ to, subject, html, text }) {
  if (!isMailerConfigured()) {
    return { ok: false, skipped: true, reason: 'SMTP not configured' };
  }

  const transport = getTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      text
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error || 'Mail send failed') };
  }
}

module.exports = {
  isMailerConfigured,
  sendMail
};
