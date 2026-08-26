const nodemailer = require('nodemailer');
const { helpers } = require('./db');

function senderWithEmail(value, email) {
  if (!email || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) return value;
  const displayName = String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim() || 'Портфолио IS1C';
  return `${displayName} <${email}>`;
}

async function getTransport(senderEmail = '') {
  const host = await helpers.getSetting('smtp_host');
  const port = parseInt(await helpers.getSetting('smtp_port') || '587');
  const user = await helpers.getSetting('smtp_user');
  const pass = await helpers.getSetting('smtp_pass');
  const configuredFrom = await helpers.getSetting('smtp_from') || 'Портфолио IS1C <noreply@is1c.ru>';
  const from = senderWithEmail(configuredFrom, senderEmail);

  if (!host || !user || !pass) return null;

  return { transport: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), from };
}

async function sendMail({ to, subject, html, senderEmail = '' }) {
  const validSenderEmail = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(senderEmail) ? senderEmail : '';
  const t = await getTransport(validSenderEmail);
  if (!t) {
    console.warn('⚠️  SMTP не настроен — письмо не отправлено:', subject);
    return false;
  }
  try {
    await t.transport.sendMail({ from: t.from, replyTo: validSenderEmail || undefined, to, subject, html });
    console.log(`📧 Письмо отправлено: ${to} — ${subject}`);
    return true;
  } catch (err) {
    console.error('❌ Ошибка отправки письма:', err.message);
    return false;
  }
}

async function testConnection() {
  const t = await getTransport();
  if (!t) throw new Error('SMTP не настроен');
  await t.transport.verify();
}

async function notifyManagerNewSubmission(employee, serverUrl) {
  const managerEmail = await helpers.getSetting('manager_email');
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

async function notifyEmployeeReviewCompleted(employee, approvedFields, rejectedFields, serverUrl) {
  if (!employee.email) return;
  const hasApproved = approvedFields.length > 0;
  const hasRejected = rejectedFields.length > 0;
  let subject;
  if (hasApproved && hasRejected) subject = '📋 Результаты проверки вашего профиля';
  else if (hasApproved) subject = '✅ Ваш профиль обновлён';
  else subject = '❌ Изменения профиля не приняты';
  const formLink = serverUrl ? `${serverUrl}/form.html?token=${employee.token}` : '';
  await sendMail({
    to: employee.email,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Портфолио IS1C</h2>
        </div>
        <div style="background:#f5f5f5;padding:24px;border-radius:0 0 8px 8px;">
          <p>Здравствуйте, ${employee.name.split(' ')[1] || employee.name}!</p>
          ${hasApproved ? `<p><strong>✅ Принятые поля:</strong></p><ul style="padding-left:20px;margin:8px 0;">${approvedFields.map(f => `<li>${f.label}${f.reason ? ' — ' + f.reason : ''}</li>`).join('')}</ul>` : ''}
          ${hasRejected ? `<p><strong>❌ Не принятые поля:</strong></p><ul style="padding-left:20px;margin:8px 0;">${rejectedFields.map(f => `<li>${f.label}${f.reason ? ' — ' + f.reason : ''}</li>`).join('')}</ul>` : ''}
          ${hasRejected ? `<p>Пожалуйста, перезаполните отклонённые поля и отправьте их на повторную проверку.</p>` : ''}
          <p style="margin-top:16px;"><a href="${formLink}" style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Перейти к анкете</a></p>
        </div>
      </div>
    `,
  });
}

async function notifyEmployeeRejected(employee, reason, rejectedFields = []) {
  if (!employee.email) return;
  const fieldList = rejectedFields.length > 0
    ? `<p><strong>Не принятые поля:</strong></p><ul style="padding-left:20px;margin:8px 0;">${rejectedFields.map(f => `<li>${f}</li>`).join('')}</ul>`
    : '';
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
          ${fieldList}
          ${reason ? `<p><strong>Комментарий:</strong> ${reason}</p>` : ''}
          <p>Пожалуйста, свяжитесь с менеджером для уточнения деталей.</p>
        </div>
      </div>
    `,
  });
}

async function notifyManagerFeedback(employee, feedback) {
  const managerEmail = await helpers.getSetting('manager_email');
  if (!managerEmail || !feedback) return;

  await sendMail({
    to: managerEmail,
    subject: `💬 Обратная связь от ${employee.name}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">Портфолио IS1C</h2>
        </div>
        <div style="background:#f5f5f5;padding:24px;border-radius:0 0 8px 8px;">
          <h3>Обратная связь от сотрудника</h3>
          <p><strong>ФИО:</strong> ${employee.name}</p>
          <p><strong>Должность:</strong> ${employee.position}</p>
          <p><strong>Оценка:</strong> ${feedback.rating ? '★'.repeat(feedback.rating) + '☆'.repeat(5 - feedback.rating) : 'Не указана'}</p>
          <p><strong>Комментарий:</strong></p>
          <p style="background:#fff;padding:12px;border-radius:4px;border:1px solid #ddd;">${feedback.comment || '—'}</p>
        </div>
      </div>
    `,
  });
}

async function notifyMassMailing(employees, subject, htmlContent, serverUrl, senderEmail = '') {
  const results = [];
  for (const emp of employees) {
    if (emp.email) {
      try {
        const link = serverUrl ? `${serverUrl}/form.html?token=${emp.token}` : '';
        const sent = await sendMail({
          to: emp.email,
          subject,
          senderEmail,
          html: htmlContent
            .replace(/{{name}}/g, emp.name.split(' ')[1] || emp.name)
            .replace(/{{fullName}}/g, emp.name)
            .replace(/{{position}}/g, emp.position || '')
            .replace(/{{city}}/g, emp.city || '')
            .replace(/{{link}}/g, link),
        });
        if (sent) {
          results.push({ email: emp.email, success: true });
        } else {
          results.push({ email: emp.email, success: false, error: 'SMTP не настроен или ошибка отправки' });
        }
      } catch (err) {
        results.push({ email: emp.email, success: false, error: err.message });
      }
    }
  }
  return results;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function notifyProjectMembersAdded(project, employeeIds, leaderName, serverUrl, senderEmail = '') {
  const uniqueIds = [...new Set((employeeIds || []).map(Number).filter(Boolean))];
  if (!project || uniqueIds.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const recipients = await helpers.getProjectNotificationRecipients(uniqueIds);
  const projectTitle = String(project.title || project.code_name || 'Проект').replace(/[\r\n]+/g, ' ').trim();
  const resumeTitle = String(project.code_name || '').trim();
  const rpName = String(leaderName || project.leader_name || 'не указан').trim();
  const results = { sent: 0, failed: 0, skipped: Math.max(0, uniqueIds.length - recipients.length) };

  for (const employee of recipients) {
    if (!employee.email || !employee.token) {
      results.skipped += 1;
      continue;
    }

    const portfolioLink = `${serverUrl}/form.html?token=${encodeURIComponent(employee.token)}`;
    const sent = await sendMail({
      to: employee.email,
      senderEmail,
      subject: `Вы добавлены в проект «${projectTitle}»`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
            <h2 style="margin:0;">Портфолио IS1C</h2>
          </div>
          <div style="background:#f5f5f5;color:#1f2937;padding:24px;border-radius:0 0 8px 8px;">
            <p>Здравствуйте, ${escapeHtml(employee.name)}!</p>
            <p>Вас добавили в состав участников проекта.</p>
            <p><strong>Проект:</strong> ${escapeHtml(projectTitle)}</p>
            ${resumeTitle && resumeTitle !== projectTitle ? `<p><strong>Название в резюме:</strong> ${escapeHtml(resumeTitle)}</p>` : ''}
            <p><strong>Руководитель проекта:</strong> ${escapeHtml(rpName)}</p>
            <p>Пожалуйста, проверьте изменения и убедитесь, что проектный опыт корректно отображается в вашем портфолио.</p>
            <p style="margin-top:20px;">
              <a href="${escapeHtml(portfolioLink)}" style="display:inline-block;background:#6c63ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Проверить портфолио</a>
            </p>
          </div>
        </div>
      `,
    });

    if (sent) results.sent += 1;
    else results.failed += 1;
  }

  return results;
}

module.exports = {
  sendMail,
  testConnection,
  notifyManagerNewSubmission,
  notifyEmployeeSubmitted,
  notifyEmployeeApproved,
  notifyEmployeeRejected,
  notifyEmployeeReviewCompleted,
  notifyManagerFeedback,
  notifyMassMailing,
  notifyProjectMembersAdded,
};
