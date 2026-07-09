const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { ZipArchive } = require('archiver');
const XLSX    = require('xlsx');
const { helpers } = require('../db');
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

// ── Список сотрудников ────────────────────────────────────────────────────────
router.get('/employees', requireAuth, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const list = helpers.getAllEmployees().map(e => ({
    ...e,
    link: `${base}/form.html?token=${e.token}`,
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
    link: `${base}/form.html?token=${emp.token}`,
  });
});

// ── Прямое редактирование менеджером ─────────────────────────────────────────
router.put('/employees/:id', requireAuth, (req, res) => {
  const updated = helpers.updateEmployee(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, employee: updated });
});

// ── Архивировать / восстановить сотрудника ───────────────────────────────────
router.delete('/employees/:id', requireAuth, (req, res) => {
  const ok = helpers.archiveEmployee(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, status: 'archived' });
});
router.post('/employees/:id/restore', requireAuth, (req, res) => {
  const ok = helpers.restoreEmployee(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, status: 'active' });
});

// ── Новый токен ───────────────────────────────────────────────────────────────
router.post('/employees/:id/new-token', requireAuth, (req, res) => {
  const emp = helpers.regenerateToken(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ token: emp.token, link: `${base}/form.html?token=${emp.token}`, employee: emp });
});

// ── Все ожидающие изменения ───────────────────────────────────────────────────
router.get('/pending', requireAuth, (req, res) => {
  res.json(helpers.getPendingGrouped());
});

// ── Подтвердить одно изменение ────────────────────────────────────────────────
router.post('/pending/:changeId/approve', requireAuth, async (req, res) => {
  const ok = helpers.approveChange(Number(req.params.changeId), req.session.managerName || '');
  if (!ok) return res.status(404).json({ error: 'Изменение не найдено' });
  res.json({ ok: true });
});

// ── Отклонить одно изменение ──────────────────────────────────────────────────
router.post('/pending/:changeId/reject', requireAuth, (req, res) => {
  const ok = helpers.rejectChange(Number(req.params.changeId), req.body.reason || '', req.session.managerName || '');
  if (!ok) return res.status(404).json({ error: 'Изменение не найдено' });
  res.json({ ok: true });
});

// ── Подтвердить все изменения сотрудника ─────────────────────────────────────
router.post('/employees/:id/approve-all', requireAuth, async (req, res) => {
  const id  = Number(req.params.id);
  const emp = helpers.getEmployee(id);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
  const applied = helpers.approveAllForEmployee(id, req.session.managerName || '');
  notifyEmployeeApproved(emp).catch(() => {});
  res.json({ ok: true, applied });
});

// ── Отклонить все изменения сотрудника ───────────────────────────────────────
router.post('/employees/:id/reject-all', requireAuth, async (req, res) => {
  const id  = Number(req.params.id);
  const emp = helpers.getEmployee(id);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
  helpers.rejectAllForEmployee(id, req.body.reason || '', req.session.managerName || '');
  notifyEmployeeRejected(emp, req.body.reason).catch(() => {});
  res.json({ ok: true });
});

// ── Создать сотрудника ──────────────────────────────────────────────────────
router.post('/employees', requireAuth, (req, res) => {
  const emp = helpers.createEmployee(req.body);
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, employee: { ...emp, link: `${base}/form.html?token=${emp.token}` } });
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
    if (Array.isArray(e)) return e.map(x => [x.institution, x.degree, x.specialty, x.year].filter(Boolean).join(', ')).join('\n');
    return String(e);
  };
  const fmtExperience = (e) => {
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (e.total) {
      const jobs = (e.jobs || []).map(j => [j.company, j.position, j.period].filter(Boolean).join(' | ')).join('\n');
      return `Общий стаж: ${e.total}${jobs ? '\n' + jobs : ''}`;
    }
    return String(e);
  };
  const fmtProject = (p) => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (Array.isArray(p)) return p.map(x => {
      const fields = [
        x.period && `Период: ${x.period}`,
        x.client && `Заказчик: ${x.client}`,
        x.project_description && `Описание: ${x.project_description}`,
        x.task_description && `Задача: ${x.task_description}`,
        x.technologies && `Технологии: ${x.technologies}`,
      ].filter(Boolean);
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
  const allowed = ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','manager_email'];
  for (const k of allowed) if (req.body[k] !== undefined) helpers.setSetting(k, req.body[k]);
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
router.get('/managers', requireAuth, (req, res) => {
  res.json({ managers: helpers.getAllManagers() });
});

// ── Менеджеры: создать ────────────────────────────────────────────────────────
router.post('/managers', requireAuth, (req, res) => {
  const { name, login, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Имя обязательно' });
  if (!login || !login.trim()) return res.status(400).json({ error: 'Логин обязателен' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
  try {
    const hash = require('bcryptjs').hashSync(password, 10);
    const manager = helpers.createManager(name.trim(), login.trim(), hash);
    res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Менеджеры: удалить ────────────────────────────────────────────────────────
router.delete('/managers/:id', requireAuth, (req, res) => {
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
router.post('/template/upload', requireAuth, upload.single('template'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const dest = path.join(templatesDir, 'custom_template.docx');
  fs.copyFileSync(req.file.path, dest);
  fs.unlinkSync(req.file.path);
  res.json({ ok: true, message: 'Шаблон загружен. Используется для всех новых резюме.' });
});

router.get('/template/info', requireAuth, (req, res) => {
  const custom = fs.existsSync(path.join(templatesDir, 'custom_template.docx'));
  res.json({ custom, placeholders: ['name','position','contacts','about','competencies','experience','project_experience','education','certification'] });
});

module.exports = router;
