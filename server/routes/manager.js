const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { ZipArchive } = require('archiver');
const XLSX    = require('xlsx');
const { helpers, FIELD_LABELS } = require('../db');
const { generateResume } = require('../wordgen');
const { generatePdfResume } = require('../pdfgen');
const { generateFromTemplate } = require('../templater');
const { convertToPdf, hasLibreOffice } = require('../pdfconv');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { notifyEmployeeApproved, notifyEmployeeRejected, testConnection } = require('../mailer');

const templatesDir = path.join(__dirname, '..', '..', 'templates');
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
const upload = multer({ dest: path.join(__dirname, '..', '..', 'uploads') });

function requireAuth(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.session.managerRole !== 'admin') return res.status(403).json({ error: 'Только главный администратор может выполнять это действие' });
  next();
}

function requireCanReview(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  const role = req.session.managerRole || 'admin';
  if (role !== 'admin' && role !== 'scrum') return res.status(403).json({ error: 'Недостаточно прав для проверки изменений' });
  next();
}

function requireCanEdit(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  const role = req.session.managerRole || 'admin';
  if (role === 'leader') return res.status(403).json({ error: 'Руководитель не может редактировать данные' });
  next();
}

// ── Список сотрудников ────────────────────────────────────────────────────────
router.get('/employees', requireAuth, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const list = helpers.getAllEmployees().map(e => ({
    ...e,
    link: `${base}/form.html?token=${e.token}&as=manager`,
  }));
  res.json(list);
});

// ── Один сотрудник ────────────────────────────────────────────────────────────
router.get('/employees/:id', requireAuth, (req, res) => {
  const emp = helpers.getEmployee(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    ...emp,
    pendingChanges: helpers.getPendingByEmployee(emp.id),
    link: `${base}/form.html?token=${emp.token}&as=manager`,
  });
});

// ── Прямое редактирование менеджером ─────────────────────────────────────────
router.put('/employees/:id', requireCanEdit, (req, res) => {
  const updated = helpers.updateEmployee(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, employee: updated });
});

// ── Архивировать / восстановить сотрудника ───────────────────────────────────
router.delete('/employees/:id', requireCanEdit, (req, res) => {
  const ok = helpers.archiveEmployee(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, status: 'archived' });
});
router.post('/employees/:id/restore', requireCanEdit, (req, res) => {
  const ok = helpers.restoreEmployee(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, status: 'active' });
});

// ── Новый токен ───────────────────────────────────────────────────────────────
router.post('/employees/:id/new-token', requireCanEdit, (req, res) => {
  const emp = helpers.regenerateToken(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ token: emp.token, link: `${base}/form.html?token=${emp.token}&as=manager`, employee: emp });
});

// ── Все ожидающие изменения ───────────────────────────────────────────────────
router.get('/pending', requireAuth, (req, res) => {
  res.json(helpers.getPendingGrouped());
});

// ── Подтвердить одно изменение ────────────────────────────────────────────────
router.post('/pending/:changeId/approve', requireCanReview, async (req, res) => {
  const ok = helpers.approveChange(Number(req.params.changeId), req.session.managerName || '');
  if (!ok) return res.status(404).json({ error: 'Изменение не найдено' });
  res.json({ ok: true });
});

// ── Отклонить одно изменение ──────────────────────────────────────────────────
router.post('/pending/:changeId/reject', requireCanReview, (req, res) => {
  const change = helpers.getChangeById(Number(req.params.changeId));
  if (!change) return res.status(404).json({ error: 'Изменение не найдено' });
  helpers.rejectChange(Number(req.params.changeId), req.body.reason || '', req.session.managerName || '');
  const emp = helpers.getEmployee(change.employee_id);
  if (emp) {
    const labels = [FIELD_LABELS[change.field_name] || change.field_name];
    notifyEmployeeRejected(emp, req.body.reason, labels).catch(() => {});
  }
  res.json({ ok: true });
});

// ── Подтвердить все изменения сотрудника ─────────────────────────────────────
router.post('/employees/:id/approve-all', requireCanReview, async (req, res) => {
  const id  = Number(req.params.id);
  const emp = helpers.getEmployee(id);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
  const applied = helpers.approveAllForEmployee(id, req.session.managerName || '');
  notifyEmployeeApproved(emp).catch(() => {});
  res.json({ ok: true, applied });
});

// ── Отклонить все изменения сотрудника ───────────────────────────────────────
router.post('/employees/:id/reject-all', requireCanReview, async (req, res) => {
  const id  = Number(req.params.id);
  const emp = helpers.getEmployee(id);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
  const pendingChanges = helpers.getPendingChangesForEmployee(id);
  helpers.rejectAllForEmployee(id, req.body.reason || '', req.session.managerName || '');
  const labels = pendingChanges.map(c => FIELD_LABELS[c.field_name] || c.field_name);
  notifyEmployeeRejected(emp, req.body.reason, labels).catch(() => {});
  res.json({ ok: true });
});

// ── Создать сотрудника ──────────────────────────────────────────────────────
router.post('/employees', requireCanEdit, (req, res) => {
  const emp = helpers.createEmployee(req.body);
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, employee: { ...emp, link: `${base}/form.html?token=${emp.token}&as=manager` } });
});

// ── Должности: список ────────────────────────────────────────────────────────
router.get('/positions', requireAuth, (req, res) => {
  res.json({ positions: helpers.getPositions() });
});

// ── Должности: добавить ──────────────────────────────────────────────────────
router.post('/positions', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Название должности обязательно' });
  const positions = helpers.addPosition(name.trim());
  res.json({ ok: true, positions });
});

// ── Должности: удалить ──────────────────────────────────────────────────────
router.delete('/positions/:name', requireAuth, (req, res) => {
  const positions = helpers.removePosition(decodeURIComponent(req.params.name));
  res.json({ ok: true, positions });
});
router.get('/employees/:id/resume', requireAuth, async (req, res) => {
  const emp = helpers.getEmployee(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  const fmt = req.query.format || 'docx';
  try {
    let buf, fn, mime;
    if (fmt === 'pdf') {
      buf = await convertToPdf(emp);
      fn = `resume_${emp.name.replace(/\s+/g, '_')}.pdf`;
      mime = 'application/pdf';
    } else {
      buf = await generateFromTemplate(emp);
      fn = `resume_${emp.name.replace(/\s+/g, '_')}.docx`;
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка генерации резюме' });
  }
});

// ── Массовый экспорт резюме (ZIP) ─────────────────────────────────────────
router.post('/employees/export', requireAuth, async (req, res) => {
  const { ids, format } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Не выбраны сотрудники' });
  const fmt = format === 'pdf' ? 'pdf' : 'docx';
  const ext = fmt === 'pdf' ? 'pdf' : 'docx';
  const mime = fmt === 'pdf' ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`resumes_${fmt}.zip`)}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', err => { console.error(err); res.status(500).json({ error: 'Ошибка архивации' }); });
  archive.pipe(res);

  for (const id of ids) {
    const emp = helpers.getEmployee(Number(id));
    if (!emp) continue;
    try {
      const buf = fmt === 'pdf' ? await convertToPdf(emp) : await generateFromTemplate(emp);
      const fn = `resume_${emp.name.replace(/\s+/g, '_')}.${ext}`;
      archive.append(buf, { name: fn });
    } catch (err) {
      console.error(`Ошибка генерации для ${emp.name}:`, err);
      archive.append(`Ошибка генерации: ${err.message}`, { name: `ERROR_${emp.name.replace(/\s+/g, '_')}.txt` });
    }
  }

  await archive.finalize();
});

// ── Массовый экспорт Excel ─────────────────────────────────────────────────
router.post('/employees/export-excel', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Не выбраны сотрудники' });

  const base = `${req.protocol}://${req.get('host')}`;
  const fmtEducation = (e) => {
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (Array.isArray(e)) {
      return e.map(x => [
        x.institution ? `Учебное заведение: ${x.institution}` : '',
        x.degree ? `Степень: ${x.degree}` : '',
        x.specialty ? `Специальность: ${x.specialty}` : '',
        x.year ? `Год окончания: ${x.year}` : '',
      ].filter(Boolean).join('\n')).join('\n\n');
    }
    return String(e);
  };
  const fmtExperience = (e) => {
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      const lines = [];
      if (e.total) lines.push('Общий стаж: ' + e.total);
      if (Array.isArray(e.jobs) && e.jobs.length > 0) {
        for (const j of e.jobs) {
          const parts = [];
          if (j.company) parts.push('Компания: ' + j.company);
          if (j.position) parts.push('Должность: ' + j.position);
          if (j.period) parts.push('Период: ' + j.period);
          if (parts.length) lines.push(parts.join('\n'));
        }
      }
      return lines.join('\n');
    }
    return '';
  };
  const fmtProject = (p) => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (Array.isArray(p)) return p.map(x => {
      const fields = [];
      if (x.period) fields.push('Период работы: ' + x.period);
      if (x.position) fields.push('Должность: ' + x.position);
      if (x.role) fields.push('Роль: ' + x.role);
      if (x.team_size) fields.push('Размер команды: ' + x.team_size);
      if (x.client) fields.push('Заказчик: ' + x.client);
      if (x.project_description) fields.push('Описание проекта: ' + x.project_description);
      if (x.task_description) fields.push('Задача, реализованная сотрудником: ' + x.task_description);
      if (x.technologies) fields.push('Программные продукты / Технологии: ' + x.technologies);
      return fields.join('\n');
    }).join('\n\n');
    return String(p);
  };

  const data = ids.map(id => {
    const e = helpers.getEmployee(Number(id));
    if (!e) return null;
    return {
      'ФИО':                 e.name,
      'Образование':         fmtEducation(e.education),
      'Должность':           e.position,
      'Контактные данные':   e.contacts,
      'Стаж работы':         fmtExperience(e.experience),
      'Обо мне':             e.about,
      'Компетенции':         e.competencies,
      'Проектный опыт':      fmtProject(e.project_experience),
      'Сертификация 1С':     e.certification,
      'Ссылка на резюме':    `${base}/api/employees/${e.id}/resume`,
    };
  }).filter(Boolean);

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    {wch:30},{wch:40},{wch:35},{wch:30},{wch:40},
    {wch:40},{wch:50},{wch:60},{wch:60},{wch:50},
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Сотрудники');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fn = `portfolio_selected_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`);
  res.send(buf);
});

// ── Настройки: получить ───────────────────────────────────────────────────────
router.get('/settings', requireAuth, (req, res) => {
  const keys = ['smtp_host','smtp_port','smtp_user','smtp_from','manager_email', 'positions'];
  const out  = {};
  for (const k of keys) out[k] = helpers.getSetting(k);
  // positions is already an array from loadSettings
  try { out.positions = JSON.parse(out.positions || '[]'); } catch { out.positions = []; }
  res.json(out);
});

// ── Настройки: сохранить ─────────────────────────────────────────────────────
router.put('/settings', requireAuth, (req, res) => {
  const role = req.session.managerRole || 'admin';
  // SMTP and AI Settings - admin only
  const adminOnly = ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from', 'ai_provider', 'ai_api_key', 'ai_folder_id', 'ai_prompt_fill', 'ai_prompt_review'];
  // Email - editable by scrumменеджера — для админа и скрама
  const canEdit = ['manager_email'];
  if (role === 'admin') {
    for (const k of [...adminOnly, ...canEdit]) if (req.body[k] !== undefined) helpers.setSetting(k, req.body[k]);
  } else if (role === 'scrum') {
    for (const k of canEdit) if (req.body[k] !== undefined) helpers.setSetting(k, req.body[k]);
  } else {
    return res.status(403).json({ error: 'Недостаточно прав для изменения настроек' });
  }
  res.json({ ok: true });
});

// ── Тест SMTP ────────────────────────────────────────────────────────────────
router.post('/settings/test-email', requireAuth, async (req, res) => {
  try {
    await testConnection();
    res.json({ ok: true, message: 'Соединение успешно' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Статистика ────────────────────────────────────────────────────────────────
router.get('/stats', requireAuth, (req, res) => {
  res.json(helpers.getStats());
});

// ── Менеджеры: список ─────────────────────────────────────────────────────────
router.get('/managers', requireAdmin, (req, res) => {
  res.json({ managers: helpers.getAllManagers() });
});

// ── Менеджеры: создать ────────────────────────────────────────────────────────
router.post('/managers', requireAdmin, (req, res) => {
  const { name, login, password, role } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Имя обязательно' });
  if (!login || !login.trim()) return res.status(400).json({ error: 'Логин обязателен' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
  try {
    const hash = require('bcryptjs').hashSync(password, 10);
    const manager = helpers.createManager(name.trim(), login.trim(), hash, role);
    res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email, role: manager.role } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Менеджеры: изменить роль ──────────────────────────────────────────────────
router.put('/managers/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Укажите роль' });
  try {
    helpers.updateManagerRole(Number(req.params.id), role);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Менеджеры: удалить ────────────────────────────────────────────────────────
router.delete('/managers/:id', requireAdmin, (req, res) => {
  try {
    helpers.deleteManager(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Менеджеры: сменить свой пароль ────────────────────────────────────────────
router.put('/managers/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Все поля обязательны' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });

  const manager = helpers.getManagerById(req.session.managerId);
  if (!manager) return res.status(404).json({ error: 'Менеджер не найден' });

  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(currentPassword, manager.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  helpers.updateManagerPassword(manager.id, hash);
  res.json({ ok: true });
});

// ── Загрузка шаблона резюме ──────────────────────────────────────────────
router.post('/template/upload', requireAdmin, upload.single('template'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const dest = path.join(templatesDir, 'custom_template.docx');
  fs.copyFileSync(req.file.path, dest);
  fs.unlinkSync(req.file.path);
  res.json({ ok: true, message: 'Шаблон загружен. Используется для всех новых резюме.' });
});

// ─── Массовая рассылка ────────────────────────────────────────────────────────
router.post('/mass-mailing', requireCanEdit, async (req, res) => {
  const { subject, htmlContent, employeeIds, sendToAll } = req.body;
  
  if (!subject || !htmlContent) {
    return res.status(400).json({ error: 'Тема и содержание письма обязательны' });
  }

  let employees = [];
  if (sendToAll) {
    employees = helpers.getAllEmployees();
  } else if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    employees = employeeIds.map(id => helpers.getEmployee(Number(id))).filter(Boolean);
  } else {
    return res.status(400).json({ error: 'Не выбраны получатели' });
  }

  if (employees.length === 0) {
    return res.status(400).json({ error: 'Нет получателей для рассылки' });
  }

  const { notifyMassMailing } = require('../mailer');
  const base = `${req.protocol}://${req.get('host')}`;
  const results = await notifyMassMailing(employees, subject, htmlContent, base);

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  res.json({ ok: true, sent: successCount, failed: failCount, details: results });
});

// ── Обратная связь: уведомление менеджера ────────────────────────────────────
router.post('/feedback/notify-manager', requireAuth, async (req, res) => {
  const { employeeId, feedback } = req.body;
  if (!employeeId || !feedback) {
    return res.status(400).json({ error: 'Необходимы employeeId и feedback' });
  }
  const emp = helpers.getEmployee(Number(employeeId));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });

  const { notifyManagerFeedback } = require('../mailer');
  await notifyManagerFeedback(emp, feedback);
  res.json({ ok: true });
});

router.get('/template/info', requireAuth, (req, res) => {
  const custom = fs.existsSync(path.join(templatesDir, 'custom_template.docx'));
  res.json({ custom, placeholders: ['name','position','contacts','about','competencies','experience','project_experience','education','certification'] });
});

// ── Компетенции по должностям ────────────────────────────────────────────────
router.get('/position-competencies', requireAuth, (req, res) => {
  res.json(helpers.getPositionCompetencies());
});

router.post('/position-competencies', requireCanEdit, (req, res) => {
  const { position, competency } = req.body;
  if (!position || !competency) return res.status(400).json({ error: 'Должность и компетенция обязательны' });
  const list = helpers.addPositionCompetency(position.trim(), competency.trim());
  res.json({ ok: true, competencies: list });
});

router.delete('/position-competencies', requireCanEdit, (req, res) => {
  const { position, competency } = req.body;
  if (!position || !competency) return res.status(400).json({ error: 'Должность и компетенция обязательны' });
  const list = helpers.removePositionCompetency(position.trim(), competency.trim());
  res.json({ ok: true, competencies: list });
});

// ── Данные для фильтров ──────────────────────────────────────────────────────
router.get('/filter-data', requireAuth, (req, res) => {
  res.json(helpers.getFilterData());
});

module.exports = router;
