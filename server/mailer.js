const nodemailer = require('nodemailer');
const { helpers } = require('./db');

function getTransport() {
  const host = helpers.getSetting('smtp_host');
  const port = parseInt(helpers.getSetting('smtp_port') || '587');
  const user = helpers.getSetting('smtp_user');
  const pass = helpers.getSetting('smtp_pass');
  const from = helpers.getSetting('smtp_from') || 'Портфолио IS1C <noreply@is1c.ru>';

  if (!host || !user || !pass) return null;

  return { transport: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), from };
}

async function sendMail({ to, subject, html }) {
  const t = getTransport();
  if (!t) {
    console.warn('⚠️  SMTP не настроен — письмо не отправлено:', subject);
    return false;
  }
  try {
    await t.transport.sendMail({ from: t.from, to, subject, html });
    console.log(`📧 Письмо отправлено: ${to} — ${subject}`);
    return true;
  } catch (err) {
    console.error('❌ Ошибка отправки письма:', err.message);
    return false;
  }
}

async function testConnection() {
  const t = getTransport();
  if (!t) throw new Error('SMTP не настроен');
  await t.transport.verify();
}

// ─── Шаблоны писем ───────────────────────────────────────────────────────────

async function notifyManagerNewSubmission(employee, serverUrl) {
  const managerEmail = helpers.getSetting('manager_email');
  if (!managerEmail) return;

  await sendMail({
    to: managerEmail,
    subject: `📋 Обновление профиля: ${employee.name}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Портфолио IS1C</h2>
        </div>
        <div style="background:#f5f5f5;padding:24px;border-radius:0 0 8px 8px;">
          <h3>Сотрудник обновил профиль</h3>
          <p><strong>ФИО:</strong> ${employee.name}</p>
          <p><strong>Должность:</strong> ${employee.position}</p>
          <p>Изменения ожидают вашего подтверждения.</p>
          <a href="${serverUrl}/review.html"
             style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:12px;">
            Проверить изменения
          </a>
        </div>
      </div>
    `,
  });
}

async function notifyEmployeeSubmitted(employee) {
  if (!employee.email) return;
  await sendMail({
    to: employee.email,
    subject: 'Ваши данные отправлены на проверку',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Портфолио IS1C</h2>
        </div>
        <div style="background:#f5f5f5;padding:24px;border-radius:0 0 8px 8px;">
          <p>Здравствуйте, ${employee.name.split(' ')[1] || employee.name}!</p>
          <p>Ваши данные профиля успешно отправлены на проверку менеджеру.</p>
          <p>После подтверждения вы получите уведомление на этот адрес.</p>
        </div>
      </div>
    `,
  });
}

async function notifyEmployeeApproved(employee) {
  if (!employee.email) return;
  await sendMail({
    to: employee.email,
    subject: '✅ Ваш профиль обновлён',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Портфолио IS1C</h2>
        </div>
        <div style="background:#f5f5f5;padding:24px;border-radius:0 0 8px 8px;">
          <p>Здравствуйте, ${employee.name.split(' ')[1] || employee.name}!</p>
          <p>✅ Менеджер подтвердил обновление вашего профиля. Данные успешно сохранены.</p>
        </div>
      </div>
    `,
  });
}

async function notifyEmployeeRejected(employee, reason) {
  if (!employee.email) return;
  await sendMail({
    to: employee.email,
    subject: '❌ Изменения профиля не приняты',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Портфолио IS1C</h2>
        </div>
        <div style="background:#f5f5f5;padding:24px;border-radius:0 0 8px 8px;">
          <p>Здравствуйте, ${employee.name.split(' ')[1] || employee.name}!</p>
          <p>К сожалению, менеджер отклонил изменения вашего профиля.</p>
          ${reason ? `<p><strong>Причина:</strong> ${reason}</p>` : ''}
          <p>Пожалуйста, свяжитесь с менеджером для уточнения деталей.</p>
        </div>
      </div>
    `,
  });
}

module.exports = {
  sendMail,
  testConnection,
  notifyManagerNewSubmission,
  notifyEmployeeSubmitted,
  notifyEmployeeApproved,
  notifyEmployeeRejected,
};
