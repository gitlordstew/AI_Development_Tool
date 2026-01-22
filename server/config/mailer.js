const nodemailer = require('nodemailer');

function parseIntEnv(key, fallback) {
  const raw = String(process.env[key] ?? '').trim();
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseBoolEnv(key, fallback) {
  const raw = String(process.env[key] ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return fallback;
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return value ? '***' : '';
  return `${value.slice(0, 2)}***${value.slice(at)}`;
}

function isMailerConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function getTransport() {
  const port = parseIntEnv('SMTP_PORT', 587);
  const secure = parseBoolEnv('SMTP_SECURE', port === 465);
  const tlsRejectUnauthorized = parseBoolEnv('SMTP_TLS_REJECT_UNAUTHORIZED', true);

  const connectionTimeout = parseIntEnv('SMTP_CONNECTION_TIMEOUT_MS', 15000);
  const greetingTimeout = parseIntEnv('SMTP_GREETING_TIMEOUT_MS', 15000);
  const socketTimeout = parseIntEnv('SMTP_SOCKET_TIMEOUT_MS', 60000);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    tls: {
      rejectUnauthorized: tlsRejectUnauthorized
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function getMailerDebugInfo() {
  const port = parseIntEnv('SMTP_PORT', 587);
  const secure = parseBoolEnv('SMTP_SECURE', port === 465);
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return {
    host: String(process.env.SMTP_HOST || ''),
    port,
    secure,
    user: maskEmail(process.env.SMTP_USER),
    from: maskEmail(from),
    connectionTimeoutMs: parseIntEnv('SMTP_CONNECTION_TIMEOUT_MS', 15000),
    greetingTimeoutMs: parseIntEnv('SMTP_GREETING_TIMEOUT_MS', 15000),
    socketTimeoutMs: parseIntEnv('SMTP_SOCKET_TIMEOUT_MS', 60000),
    tlsRejectUnauthorized: parseBoolEnv('SMTP_TLS_REJECT_UNAUTHORIZED', true)
  };
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
  sendMail,
  getMailerDebugInfo
};
