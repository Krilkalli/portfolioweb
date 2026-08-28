require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const weakSecrets = new Set([
  'portfolio-secret-key-change-me',
  'is1c-portfolio-secret-2024-change-me',
  'change_this_to_a_random_secret_string',
]);

function persistentSecret(envValue, filename) {
  const provided = String(envValue || '').trim();
  if (provided.length >= 32 && !weakSecrets.has(provided)) return provided;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const secretPath = path.join(dataDir, filename);
  if (fs.existsSync(secretPath)) {
    const saved = fs.readFileSync(secretPath, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }
  const generated = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

function booleanEnv(name, fallback = false) {
  if (process.env[name] === undefined) return fallback;
  return process.env[name] === 'true';
}

function readSecretFile(filename) {
  const resolved = String(filename || '').trim();
  if (!resolved) return '';
  return fs.readFileSync(resolved, 'utf8').trim();
}

module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  trustProxy: booleanEnv('TRUST_PROXY', false),
  sessionSecret: persistentSecret(process.env.SESSION_SECRET, '.session-secret'),
  secureCookies: booleanEnv(
    'SESSION_COOKIE_SECURE',
    String(process.env.PUBLIC_BASE_URL || '').startsWith('https://') || Boolean(process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH)
  ),
  tls: {
    keyPath: String(process.env.TLS_KEY_PATH || '').trim(),
    certPath: String(process.env.TLS_CERT_PATH || '').trim(),
  },
  defaultManagerEmail: (process.env.DEFAULT_MANAGER_EMAIL || `admin@${process.env.AD_DOMAIN || 'test.local'}`).toLowerCase(),
  defaultManagerPassword: persistentSecret(process.env.DEFAULT_MANAGER_PASSWORD, '.initial-admin-password'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Портфолио IS1C <noreply@is1c.ru>',
  },
  managerEmail: process.env.MANAGER_EMAIL || '',
  ad: {
    enabled: process.env.AD_ENABLED === 'true',
    url: process.env.AD_URL || '',
    domain: process.env.AD_DOMAIN || 'test.local',
    // Группа AD, чья принадлежность даёт роль "admin" (Chief Manager) в приложении.
    adminGroup: process.env.AD_ADMIN_GROUP || 'HR_Managers',
    allowedGroups: String(process.env.AD_ALLOWED_GROUPS || process.env.AD_ADMIN_GROUP || 'HR_Managers')
      .split(',').map(value => value.trim()).filter(Boolean),
    defaultRole: process.env.AD_DEFAULT_ROLE || 'leader',
    allowLocalFallback: booleanEnv('AD_ALLOW_LOCAL_FALLBACK', false),
    tlsRejectUnauthorized: booleanEnv('AD_TLS_REJECT_UNAUTHORIZED', true),
    tlsCa: process.env.AD_TLS_CA_PATH ? fs.readFileSync(process.env.AD_TLS_CA_PATH) : undefined,
  },
  pg: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'portfolio',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD_FILE ? readSecretFile(process.env.PG_PASSWORD_FILE) : (process.env.PG_PASSWORD || undefined),
  },
};
