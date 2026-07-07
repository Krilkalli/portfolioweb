require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'portfolio-secret-key-change-me',
  defaultManagerPassword: process.env.DEFAULT_MANAGER_PASSWORD || 'Admin1234!',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Портфолио IS1C <noreply@is1c.ru>',
  },
  managerEmail: process.env.MANAGER_EMAIL || '',
};
