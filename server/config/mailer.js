const nodemailer = require('nodemailer');
const https = require('https');

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

function isSmtpConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function isResendConfigured() {
  return !!String(process.env.RESEND_API_KEY || '').trim();
}

function isMailerConfigured() {
  return isResendConfigured() || isSmtpConfigured();
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

function requestJson({ method, url, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        method,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode || 0;
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status, raw, json });
        });
      }
    );

    if (timeoutMs && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Request timeout'));
      });
    }

    req.on('error', reject);
    req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

async function sendMailResend({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, skipped: true, reason: 'RESEND_API_KEY not configured' };

  // Resend requires a verified sender.
  const from = String(process.env.RESEND_FROM || process.env.SMTP_FROM || 'onboarding@resend.dev').trim();
  const usingDefaultTestingFrom = !String(process.env.RESEND_FROM || '').trim();

  const timeoutMs = parseIntEnv('RESEND_TIMEOUT_MS', 15000);
  const payload = {
    from,
    to,
    subject,
    html,
    text
  };

  const { status, json, raw } = await requestJson({
    method: 'POST',
    url: 'https://api.resend.com/emails',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: payload,
    timeoutMs
  });

  if (status >= 200 && status < 300) {
    return { ok: true, provider: 'resend', id: json?.id, testingFrom: usingDefaultTestingFrom };
  }

  const message = json?.message || json?.error || raw || `HTTP ${status}`;
  return { ok: false, provider: 'resend', error: `Resend error: ${message}` };
}

function getMailerDebugInfo() {
  const port = parseIntEnv('SMTP_PORT', 587);
  const secure = parseBoolEnv('SMTP_SECURE', port === 465);
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return {
    provider: isResendConfigured() ? 'resend' : isSmtpConfigured() ? 'smtp' : 'none',
    resendConfigured: isResendConfigured(),
    resendFrom: maskEmail(process.env.RESEND_FROM),
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
  if (isResendConfigured()) {
    try {
      return await sendMailResend({ to, subject, html, text });
    } catch (error) {
      return { ok: false, provider: 'resend', error: error?.message || String(error || 'Mail send failed') };
    }
  }

  if (!isSmtpConfigured()) {
    return { ok: false, skipped: true, reason: 'Email not configured (SMTP/Resend)' };
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
    return { ok: true, provider: 'smtp' };
  } catch (error) {
    return { ok: false, provider: 'smtp', error: error?.message || String(error || 'Mail send failed') };
  }
}

module.exports = {
  isMailerConfigured,
  sendMail,
  getMailerDebugInfo
};
