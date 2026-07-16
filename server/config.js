require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
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
  ad: {
    enabled: process.env.AD_ENABLED === 'true',
    url: process.env.AD_URL || 'ldaps://samba-ad:636',
    domain: process.env.AD_DOMAIN || 'test.local',
    // Группа AD, чья принадлежность даёт роль "admin" (Chief Manager) в приложении.
    adminGroup: process.env.AD_ADMIN_GROUP || 'HR_Managers',
    // Роль по умолчанию для остальных пользователей AD, не входящих в adminGroup.
    defaultRole: process.env.AD_DEFAULT_ROLE || 'scrum',
  },
  pg: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'portfolio',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
  },
};
