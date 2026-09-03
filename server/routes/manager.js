const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const archiver = require('archiver');
const XLSX    = require('xlsx');
const { helpers, FIELD_LABELS, sessions } = require('../db');
const { generateResume } = require('../wordgen');
const { generatePdfResume } = require('../pdfgen');
const { generateFromTemplate } = require('../templater');
const { convertToPdf, hasLibreOffice } = require('../pdfconv');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { notifyEmployeeApproved, notifyEmployeeRejected, notifyEmployeeReviewCompleted, testConnection, sendMail } = require('../mailer');
const { parseProjectExperienceFile } = require('../projectExperienceImport');
const { getPublicBaseUrl } = require('../publicUrl');

const templatesDir = path.join(__dirname, '..', '..', 'templates');
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const projectUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!['.xls', '.xlsx'].includes(extension)) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
    }
    callback(null, true);
  },
});
const templateUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (path.extname(file.originalname || '').toLowerCase() !== '.docx') {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'template'));
    }
    callback(null, true);
  },
});

async function sendReviewSummaryIfDone(employeeId, req) {
  const pendingCount = await helpers.countPendingForEmployee(employeeId);
  if (pendingCount > 0) return;
  const emp = await helpers.getEmployee(employeeId);
  if (!emp) return;
  const base = getPublicBaseUrl(req);
  const reviewed = await helpers.getReviewedChangesForEmployee(employeeId);
  const approvedLabels = reviewed.filter(c => c.status === 'approved').map(c => ({ label: FIELD_LABELS[c.field_name] || c.field_name, reason: '' }));
  const rejectedLabels = reviewed.filter(c => c.status === 'rejected').map(c => ({ label: FIELD_LABELS[c.field_name] || c.field_name, reason: c.reject_reason || '' }));
  notifyEmployeeReviewCompleted(emp, approvedLabels, rejectedLabels, base).catch(() => {});
}

function requireAuth(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.session.managerRole !== 'admin') return res.status(403).json({ error: 'Только главный администратор может выполнять это действие' });
  next();
}

function requireProjectAccess(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  const role = req.session.managerRole || '';
  if (!['admin', 'leader'].includes(role)) return res.status(403).json({ error: 'Недостаточно прав для работы с проектами' });
  if (role === 'leader' && !req.session.managerEmployeeId) {
    return res.status(403).json({ error: 'Учётная запись РП не связана с сотрудником' });
  }
  next();
}

function canAccessProject(req, project) {
  if (req.session.managerRole === 'admin') return true;
  return req.session.managerRole === 'leader'
    && Number(project?.leader_employee_id) === Number(req.session.managerEmployeeId);
}

function requireCanReview(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  const role = req.session.managerRole || 'leader';
  if (role !== 'admin' && role !== 'scrum') return res.status(403).json({ error: 'Недостаточно прав для проверки изменений' });
  next();
}

function requireCanEdit(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  const role = req.session.managerRole || 'leader';
  if (role === 'leader') return res.status(403).json({ error: 'Руководитель не может редактировать данные' });
  next();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function senderWithEmail(value, email) {
  const displayName = String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim() || 'Портфолио IS1C';
  return `${displayName} <${email}>`;
}

router.get('/employees', requireCanReview, async (req, res, next) => {

  try {
    const base = getPublicBaseUrl(req);
    const list = (await helpers.getAllEmployees()).map(e => ({
      ...e,
      link: `${base}/form.html?token=${e.token}&as`,
    }));
    res.json(list);
  } catch (err) { next(err); }
});

router.get('/employees/:id', requireCanReview, async (req, res, next) => {
  try {
    const emp = await helpers.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
    const base = getPublicBaseUrl(req);
    res.json({
      ...emp,
      pendingChanges: await helpers.getPendingByEmployee(emp.id),
      link: `${base}/form.html?token=${emp.token}&as`,
    });
  } catch (err) { next(err); }
});

router.put('/employees/:id', requireCanEdit, async (req, res, next) => {
  try {
    const updated = await helpers.updateEmployee(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ ok: true, employee: updated });
  } catch (err) { next(err); }
});

router.delete('/employees/:id', requireCanEdit, async (req, res, next) => {
  try {
    const ok = await helpers.archiveEmployee(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ ok: true, status: 'archived' });
  } catch (err) { next(err); }
});

router.post('/employees/:id/restore', requireCanEdit, async (req, res, next) => {
  try {
    const ok = await helpers.restoreEmployee(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json({ ok: true, status: 'active' });
  } catch (err) { next(err); }
});

// Безвозвратное удаление — только для админа и только из архива.
router.delete('/employees/:id/permanent', requireAdmin, async (req, res, next) => {
  try {
    const result = await helpers.deleteEmployeePermanently(Number(req.params.id));
    if (result === null) return res.status(404).json({ error: 'Сотрудник не найден' });
    if (result === 'not_archived') return res.status(400).json({ error: 'Удалить безвозвратно можно только сотрудника из архива' });
    if (result.photo) {
      const photoPath = path.join(__dirname, '..', '..', 'uploads', result.photo);
      fs.unlink(photoPath, () => {}); // best-effort, не блокируем ответ при ошибке
    }
    res.json({ ok: true, status: 'deleted' });
  } catch (err) { next(err); }
});

router.post('/employees/:id/new-token', requireCanEdit, async (req, res, next) => {
  try {
    const emp = await helpers.regenerateToken(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
    const base = getPublicBaseUrl(req);
    res.json({ token: emp.token, link: `${base}/form.html?token=${emp.token}&as`, employee: emp });
  } catch (err) { next(err); }
});

router.get('/pending', requireCanReview, async (req, res, next) => {
  try {
    res.json(await helpers.getPendingGrouped());
  } catch (err) { next(err); }
});

router.get('/approval-history', requireCanReview, async (req, res, next) => {
  try {
    const history = await helpers.getApprovalHistory(req.query.limit);
    res.json({
      ...history,
      items: history.items.map(item => ({
        ...item,
        field_label: FIELD_LABELS[item.field_name] || item.field_name || 'Изменение',
      })),
    });
  } catch (err) { next(err); }
});

router.post('/approval-history/:historyId/revert', requireCanReview, async (req, res, next) => {
  try {
    const result = await helpers.revertApprovalHistory(Number(req.params.historyId), req.session.managerName || '');
    if (result.ok) return res.json(result);
    if (result.reason === 'not_found') return res.status(404).json({ error: 'Запись истории не найдена' });
    if (result.reason === 'already_reverted') return res.status(409).json({ error: 'Это изменение уже отменено' });
    if (result.reason === 'changed_after_approval') {
      return res.status(409).json({ error: 'После этого подтверждения поле уже менялось. Автоматическая отмена небезопасна.' });
    }
    return res.status(409).json({ error: 'Это изменение нельзя отменить автоматически' });
  } catch (err) { next(err); }
});

router.post('/approval-history/:historyId/return-to-pending', requireCanReview, async (req, res, next) => {
  try {
    const result = await helpers.returnHistoryToPending(Number(req.params.historyId), req.session.managerName || '');
    if (result.ok) return res.json(result);
    if (result.reason === 'not_found') return res.status(404).json({ error: 'Запись истории не найдена' });
    if (result.reason === 'already_pending') return res.status(409).json({ error: 'Изменение уже ожидает подтверждения' });
    if (result.reason === 'changed_after_decision') return res.status(409).json({ error: 'Поле изменялось после этого решения. Возврат может перезаписать новые данные.' });
    return res.status(409).json({ error: 'Изменение нельзя вернуть на подтверждение' });
  } catch (err) { next(err); }
});

router.post('/approval-history/:historyId/approve', requireCanReview, async (req, res, next) => {
  try {
    const result = await helpers.decideApprovalHistory(Number(req.params.historyId), 'approved', '', req.session.managerName || '');
    if (result.ok) return res.json(result);
    if (result.reason === 'not_found') return res.status(404).json({ error: 'Запись истории не найдена' });
    if (result.reason === 'already_approved') return res.status(409).json({ error: 'Это значение уже подтверждено и находится в портфолио' });
    if (result.reason === 'already_pending') return res.status(409).json({ error: 'По этому полю уже есть другая заявка на подтверждение' });
    if (result.reason === 'changed_after_decision') return res.status(409).json({ error: 'Поле изменялось после этого решения. Подтверждение может перезаписать новые данные.' });
    return res.status(409).json({ error: 'Изменение нельзя подтвердить' });
  } catch (err) { next(err); }
});

router.post('/approval-history/:historyId/reject', requireCanReview, async (req, res, next) => {
  try {
    const result = await helpers.decideApprovalHistory(Number(req.params.historyId), 'rejected', req.body.reason || '', req.session.managerName || '');
    if (result.ok) return res.json(result);
    if (result.reason === 'not_found') return res.status(404).json({ error: 'Запись истории не найдена' });
    if (result.reason === 'already_rejected') return res.status(409).json({ error: 'Это изменение уже отклонено' });
    if (result.reason === 'already_pending') return res.status(409).json({ error: 'По этому полю уже есть другая заявка на подтверждение' });
    if (result.reason === 'changed_after_decision') return res.status(409).json({ error: 'Поле изменялось после этого решения. Отклонение может перезаписать новые данные.' });
    return res.status(409).json({ error: 'Изменение нельзя отклонить' });
  } catch (err) { next(err); }
});

router.post('/pending/:changeId/approve', requireCanReview, async (req, res, next) => {
  try {
    const change = await helpers.getChangeById(Number(req.params.changeId));
    if (!change) return res.status(404).json({ error: 'Изменение не найдено' });
    await helpers.approveChange(Number(req.params.changeId), req.session.managerName || '');
    await sendReviewSummaryIfDone(change.employee_id, req);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/pending/:changeId/reject', requireCanReview, async (req, res, next) => {
  try {
    const change = await helpers.getChangeById(Number(req.params.changeId));
    if (!change) return res.status(404).json({ error: 'Изменение не найдено' });
    await helpers.rejectChange(Number(req.params.changeId), req.body.reason || '', req.session.managerName || '');
    await sendReviewSummaryIfDone(change.employee_id, req);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/employees/:id/approve-all', requireCanReview, async (req, res, next) => {
  try {
    const id  = Number(req.params.id);
    const emp = await helpers.getEmployee(id);
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
    const applied = await helpers.approveAllForEmployee(id, req.session.managerName || '');
    await sendReviewSummaryIfDone(id, req);
    res.json({ ok: true, applied });
  } catch (err) { next(err); }
});

router.post('/employees/:id/reject-all', requireCanReview, async (req, res, next) => {
  try {
    const id  = Number(req.params.id);
    const emp = await helpers.getEmployee(id);
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
    await helpers.rejectAllForEmployee(id, req.body.reason || '', req.session.managerName || '');
    await sendReviewSummaryIfDone(id, req);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/employees', requireCanEdit, async (req, res, next) => {
  try {
    const emp = await helpers.createEmployee(req.body);
    const base = getPublicBaseUrl(req);
    res.json({ ok: true, employee: { ...emp, link: `${base}/form.html?token=${emp.token}&as` } });
  } catch (err) { next(err); }
});

router.post('/employees/assign-rp', requireAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Выберите сотрудников' });
    }
    const updated = await helpers.setEmployeesRp(ids, true);
    res.json({ ok: true, updated });
  } catch (err) { next(err); }
});

router.get('/positions', requireAuth, async (req, res, next) => {
  try {
    res.json({ positions: await helpers.getPositions() });
  } catch (err) { next(err); }
});

router.post('/positions', requireCanEdit, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название должности обязательно' });
    const positions = await helpers.addPosition(name.trim());
    res.json({ ok: true, positions });
  } catch (err) { next(err); }
});

router.delete('/positions/:name', requireCanEdit, async (req, res, next) => {
  try {
    const positions = await helpers.removePosition(decodeURIComponent(req.params.name));
    res.json({ ok: true, positions });
  } catch (err) { next(err); }
});

// ─── Position Aliases ──────────────────────────────────────────────────────────
async function getAliasesSettings() {
  const raw = await helpers.getSetting('position_aliases');
  try { return JSON.parse(raw || '{}'); } catch { return { aliases: {}, useAliases: false }; }
}

async function applyPositionAlias(emp) {
  if (!emp) return emp;
  const settings = await getAliasesSettings();
  if (settings.useAliases && settings.aliases && settings.aliases[emp.position]) {
    return { ...emp, position: settings.aliases[emp.position] };
  }
  return emp;
}

router.get('/position-aliases', requireAuth, async (req, res, next) => {
  try {
    const settings = await getAliasesSettings();
    res.json(settings);
  } catch (err) { next(err); }
});

router.put('/position-aliases', requireCanEdit, async (req, res, next) => {
  try {
    const { aliases, useAliases } = req.body;
    await helpers.setSetting('position_aliases', JSON.stringify({ aliases: aliases || {}, useAliases: !!useAliases }));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/employees/:id/resume', requireCanReview, async (req, res, next) => {
  try {
    let emp = await helpers.getEmployee(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
    emp = await applyPositionAlias(emp);
    const fmt = req.query.format || 'docx';
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

router.post('/employees/export', requireCanReview, async (req, res, next) => {
  try {
    const { ids, format } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Не выбраны сотрудники' });
    const fmt = format === 'pdf' ? 'pdf' : 'docx';
    const ext = fmt === 'pdf' ? 'pdf' : 'docx';
    const mime = fmt === 'pdf' ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`resumes_${fmt}.zip`)}`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error(err); res.status(500).json({ error: 'Ошибка архивации' }); });
    archive.pipe(res);

    for (const id of ids) {
      let emp = await helpers.getEmployee(Number(id));
      if (!emp) continue;
      emp = await applyPositionAlias(emp);
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
  } catch (err) { next(err); }
});

router.post('/employees/export-excel', requireCanReview, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Не выбраны сотрудники' });

    const base = getPublicBaseUrl(req);
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
        if (x.project_name) fields.push('Название проекта: ' + x.project_name);
        if (x.period) fields.push('Период работы: ' + x.period);
        if (x.position) fields.push('Должность: ' + x.position);
        if (x.role) fields.push('Роль: ' + x.role);
        if (x.team_size) fields.push('Количество участников команды: ' + x.team_size);
        if (x.client) fields.push('Заказчик: ' + x.client);
        if (x.project_description) fields.push('Описание проекта: ' + x.project_description);
        if (x.functional_area) fields.push('Функциональная область: ' + x.functional_area);
        if (x.technologies) fields.push('Программные продукты / Технологии: ' + x.technologies);
        return fields.join('\n');
      }).join('\n\n');
      return String(p);
    };

    const empResults = [];
    for (const id of ids) {
      let e = await helpers.getEmployee(Number(id));
      if (!e) continue;
      e = await applyPositionAlias(e);
      empResults.push({
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
      });
    }

    const ws = XLSX.utils.json_to_sheet(empResults);
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
  } catch (err) { next(err); }
});

router.get('/projects', requireProjectAccess, async (req, res, next) => {
  try {
    const projects = req.session.managerRole === 'admin'
      ? await helpers.getAllProjects()
      : await helpers.getProjectsForLeaderEmployee(req.session.managerEmployeeId);
    res.json({ projects });
  } catch (err) { next(err); }
});

router.post('/employees/remove-rp', requireAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Выберите сотрудников' });
    }
    const result = await helpers.removeEmployeesRp(ids);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

router.get('/projects/functional-blocks', requireProjectAccess, async (req, res, next) => {
  try {
    res.json({ blocks: await helpers.getProjectFunctionalBlocks() });
  } catch (err) { next(err); }
});

router.get('/project-employees', requireProjectAccess, async (req, res, next) => {
  try {
    const employees = (await helpers.getAllEmployees())
      .filter(employee => employee.status !== 'archived')
      .map(employee => ({
        id: employee.id,
        name: employee.name,
        position: employee.position,
        email: employee.email,
        is_rp: employee.is_rp,
        status: employee.status,
      }));
    res.json({ employees });
  } catch (err) { next(err); }
});

router.get('/projects/export-register', requireAdmin, async (req, res, next) => {
  try {
    const projects = await helpers.getAllProjects();
    const headers = ['Ссылка','НомерСтроки','Сотрудник','Должность','ДатаВхода','ДатаВыхода','ФункциональнаяОбласть','ПрограммныйПродукт','Опыт','ОсновнойКонсультант','Проект','ДатаНачала','ДатаОкончания'];
    const rows = [];
    for (const project of projects) {
      if (Array.isArray(project.source_data) && project.source_data.length) {
        for (const row of project.source_data) {
          rows.push({
            Ссылка: row.sourceReference || '',
            НомерСтроки: row.sourceRowNumber || '',
            Сотрудник: row.employeeName || '',
            Должность: row.position || '',
            ДатаВхода: row.participationStart || '',
            ДатаВыхода: row.participationEnd || '',
            ФункциональнаяОбласть: row.functionalBlock || '',
            ПрограммныйПродукт: row.technology || '',
            Опыт: row.experienceType || '',
            ОсновнойКонсультант: row.isPrimaryConsultant ? 'Да' : 'Нет',
            Проект: project.title || '',
            ДатаНачала: row.projectStart || project.start_period || '',
            ДатаОкончания: row.projectEnd || project.end_period || '',
          });
        }
      } else {
        for (const member of project.team_members || []) {
          const blocks = Array.isArray(member.functional_areas) && member.functional_areas.length
            ? member.functional_areas
            : (project.functional_area ? String(project.functional_area).split(/[,;\n]/).map(value => value.trim()).filter(Boolean) : ['']);
          for (const block of blocks) rows.push({
            Ссылка: project.source_system || 'Портфолио',
            НомерСтроки: '',
            Сотрудник: member.employee_name || member.name || '',
            Должность: member.position || '',
            ДатаВхода: member.participation_start || '',
            ДатаВыхода: member.participation_end || '',
            ФункциональнаяОбласть: block,
            ПрограммныйПродукт: (member.technologies || []).join?.(', ') || project.technologies || '',
            Опыт: (member.experience_types || []).join?.(', ') || '',
            ОсновнойКонсультант: member.is_primary_consultant ? 'Да' : 'Нет',
            Проект: project.title || '',
            ДатаНачала: project.start_period || '',
            ДатаОкончания: project.end_period || '',
          });
        }
      }
    }
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    sheet['!cols'] = headers.map((header, index) => ({ wch: [34,12,34,34,14,14,42,32,22,22,38,14,14][index] }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Регистр опыта');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const filename = `upp_project_experience_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (err) { next(err); }
});

router.get('/projects/:id', requireProjectAccess, async (req, res, next) => {
  try {
    const project = await helpers.getProjectById(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'Этот проект не закреплён за вами' });
    res.json({ project });
  } catch (err) { next(err); }
});

router.post('/projects', requireAdmin, async (req, res, next) => {
  try {
    const project = await helpers.createProject(req.body || {});
    res.json({ ok: true, project });
  } catch (err) {
    console.error('Ошибка создания проекта:', err);
    res.status(400).json({ error: 'Не удалось создать проект. Проверьте заполненные поля.' });
  }
});

router.put('/projects/:id', requireProjectAccess, async (req, res, next) => {
  try {
    const previousProject = await helpers.getProjectById(Number(req.params.id));
    if (!previousProject) return res.status(404).json({ error: 'Проект не найден' });
    if (!canAccessProject(req, previousProject)) return res.status(403).json({ error: 'Этот проект не закреплён за вами' });
    const fields = { ...(req.body || {}) };
    if (req.session.managerRole === 'leader') {
      delete fields.leader_employee_id;
      delete fields.leader_name;
      delete fields.status;
    }
    const project = await helpers.updateProject(Number(req.params.id), fields);
    await helpers.syncProjectTeamMembers(project);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/projects/import', requireAdmin, projectUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const parsed = parseProjectExperienceFile(req.file.path);
    if (!parsed.projects.length) return res.status(400).json({ error: 'В файле не найдено проектов для импорта' });
    const result = await helpers.importProjectExperience(parsed);
    res.json({
      ok: true,
      ...result,
      imported: result.projects,
      sourceRows: parsed.totalRows,
      activeRows: parsed.activeRows,
      skippedInactiveRows: parsed.skippedInactiveRows,
      inactiveEmployees: parsed.inactiveEmployees.length,
    });
  } catch (err) {
    next(err);
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

router.post('/projects/archive', requireAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Выберите проекты' });
    }
    const archived = await helpers.archiveProjects(ids);
    res.json({ ok: true, archived });
  } catch (err) { next(err); }
});

router.post('/projects/restore', requireAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Выберите проекты' });
    const restored = await helpers.restoreProjects(ids);
    res.json({ ok: true, restored });
  } catch (err) { next(err); }
});

router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const keys = ['smtp_host','smtp_port','smtp_user','smtp_from','manager_email', 'positions'];
    const out  = {};
    for (const k of keys) out[k] = await helpers.getSetting(k);
    out.current_manager_email = req.session.managerEmail || req.session.managerLogin || '';
    try { out.positions = JSON.parse(out.positions || '[]'); } catch { out.positions = []; }
    res.json(out);
  } catch (err) { next(err); }
});

router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const role = req.session.managerRole || 'admin';
    const managerEmail = normalizeEmail(req.session.managerEmail || req.session.managerLogin);
    if (!isEmail(managerEmail)) return res.status(400).json({ error: 'Войдите в систему по электронной почте повторно' });
    const adminOnly = ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from', 'ai_provider', 'ai_api_key', 'ai_folder_id', 'ai_base_url', 'ai_model_name', 'ai_prompt_fill', 'ai_prompt_review'];
    const canEdit = ['manager_email'];
    const payload = {
      ...req.body,
      smtp_user: managerEmail,
      smtp_from: senderWithEmail(req.body.smtp_from, managerEmail),
      manager_email: managerEmail,
    };
    if (role === 'admin') {
      for (const k of [...adminOnly, ...canEdit]) if (payload[k] !== undefined) await helpers.setSetting(k, payload[k]);
    } else if (role === 'scrum') {
      for (const k of canEdit) if (payload[k] !== undefined) await helpers.setSetting(k, payload[k]);
    } else {
      return res.status(403).json({ error: 'Недостаточно прав для изменения настроек' });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }

});

router.post('/settings/test-email', requireAdmin, async (req, res, next) => {
  try {
    await testConnection();
    res.json({ ok: true, message: 'Соединение успешно' });
  } catch (err) {
    console.error('Ошибка проверки SMTP:', err);
    res.status(400).json({ error: 'Не удалось подключиться к почтовому серверу. Проверьте настройки.' });
  }
});

router.get('/stats', requireCanReview, async (req, res, next) => {
  try {
    res.json(await helpers.getStats());
  } catch (err) { next(err); }
});

router.get('/managers', requireAdmin, async (req, res, next) => {
  try {
    res.json({ managers: await helpers.getAllManagers() });
  } catch (err) { next(err); }
});

router.post('/managers', requireAdmin, async (req, res, next) => {
  try {
    const { name, password, role, employeeId } = req.body;
    const validRoles = new Set(['admin', 'scrum', 'leader']);
    const email = normalizeEmail(req.body.email || req.body.login);
    if (!name || !name.trim()) return res.status(400).json({ error: 'Имя обязательно' });
    if (!email) return res.status(400).json({ error: 'Почта обязательна' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Введите корректный адрес электронной почты' });
    if (!password || password.length < 12) return res.status(400).json({ error: 'Пароль должен быть не менее 12 символов' });
    if (!validRoles.has(role)) return res.status(400).json({ error: 'Выберите корректную роль пользователя' });
    const hash = require('bcryptjs').hashSync(password, 12);
    if (role === 'leader' && !Number(employeeId || 0)) return res.status(400).json({ error: 'Для роли РП выберите сотрудника' });
    const manager = await helpers.createManager(name.trim(), email, hash, role, employeeId);
    res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email, role: manager.role, employeeId: manager.employee_id } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/managers/:id/role', requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    const managerId = Number(req.params.id);
    if (!role) return res.status(400).json({ error: 'Укажите роль' });
    if (managerId === Number(req.session.managerId)) {
      return res.status(400).json({ error: 'Нельзя изменить собственную роль' });
    }
    await helpers.updateManagerRole(managerId, role);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/managers/:id', requireAdmin, async (req, res, next) => {
  try {
    const managerId = Number(req.params.id);
    if (managerId === Number(req.session.managerId)) {
      return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись' });
    }
    await helpers.deleteManager(managerId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/managers/me/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Все поля обязательны' });
    if (newPassword.length < 12) return res.status(400).json({ error: 'Пароль должен быть не менее 12 символов' });

    const manager = await helpers.getManagerById(req.session.managerId);
    if (!manager) return res.status(404).json({ error: 'Менеджер не найден' });

    if (!bcrypt.compareSync(currentPassword, manager.password_hash)) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }

    const hash = bcrypt.hashSync(newPassword, 12);
    await helpers.updateManagerPassword(manager.id, hash);
    await sessions.destroyForManager(manager.id);
    req.session.destroy(() => res.json({ ok: true, reauthenticationRequired: true }));
  } catch (err) { next(err); }
});

router.post('/template/upload', requireAdmin, templateUpload.single('template'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const dest = path.join(templatesDir, 'custom_template.docx');
  fs.copyFileSync(req.file.path, dest);
  fs.unlinkSync(req.file.path);
  res.json({ ok: true, message: 'Шаблон загружен. Используется для всех новых резюме.' });
});

router.post('/mass-mailing', requireCanEdit, async (req, res, next) => {
  try {
    const { subject, htmlContent, employeeIds, sendToAll } = req.body;

    if (!subject || !htmlContent) {
      return res.status(400).json({ error: 'Тема и содержание письма обязательны' });
    }

    let employees = [];
    if (sendToAll) {
      employees = await helpers.getAllEmployees();
    } else if (Array.isArray(employeeIds) && employeeIds.length > 0) {
      const empResults = [];
      for (const id of employeeIds) {
        const e = await helpers.getEmployee(Number(id));
        if (e) empResults.push(e);
      }
      employees = empResults;
    } else {
      return res.status(400).json({ error: 'Не выбраны получатели' });
    }

    if (employees.length === 0) {
      return res.status(400).json({ error: 'Нет получателей для рассылки' });
    }

    const { notifyMassMailing } = require('../mailer');
    const base = getPublicBaseUrl(req);
    const senderEmail = req.session.managerEmail || req.session.managerLogin || '';
    const results = await notifyMassMailing(employees, subject, htmlContent, base, senderEmail);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({ ok: true, sent: successCount, failed: failCount, details: results });
  } catch (err) { next(err); }
});

router.post('/feedback/notify-manager', requireAuth, async (req, res, next) => {
  try {
    const { employeeId, feedback } = req.body;
    if (!employeeId || !feedback) {
      return res.status(400).json({ error: 'Необходимы employeeId и feedback' });
    }
    const emp = await helpers.getEmployee(Number(employeeId));
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });

    const { notifyManagerFeedback } = require('../mailer');
    await notifyManagerFeedback(emp, feedback);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/feedback', requireAuth, async (req, res, next) => {
  try {
    const rows = await helpers.getAllFeedback();
    res.json({ feedback: rows });
  } catch (err) { next(err); }
});

router.post('/feedback/summarize', requireAuth, async (req, res, next) => {
  try {
    const rows = await helpers.getAllFeedback();
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'Нет отзывов для суммаризации' });
    }
    const ai = require('../ai');
    const summary = await ai.summarizeFeedback(rows);
    res.json({ summary });
  } catch (err) { next(err); }
});

router.get('/template/info', requireAuth, (req, res) => {
  const custom = fs.existsSync(path.join(templatesDir, 'custom_template.docx'));
  res.json({ custom, placeholders: ['name','position','contacts','about','competencies','experience','project_experience','education','certification'] });
});

router.get('/position-competencies', requireAuth, async (req, res, next) => {
  try {
    res.json(await helpers.getPositionCompetencies());
  } catch (err) { next(err); }
});

router.post('/position-competencies', requireCanEdit, async (req, res, next) => {
  try {
    const { position, competency } = req.body;
    if (!position || !competency) return res.status(400).json({ error: 'Должность и компетенция обязательны' });
    const list = await helpers.addPositionCompetency(position.trim(), competency.trim());
    res.json({ ok: true, competencies: list });
  } catch (err) { next(err); }
});

router.delete('/position-competencies', requireCanEdit, async (req, res, next) => {
  try {
    const { position, competency } = req.body;
    if (!position || !competency) return res.status(400).json({ error: 'Должность и компетенция обязательны' });
    const list = await helpers.removePositionCompetency(position.trim(), competency.trim());
    res.json({ ok: true, competencies: list });
  } catch (err) { next(err); }
});

router.get('/filter-data', requireAuth, async (req, res, next) => {
  try {
    res.json(await helpers.getFilterData());
  } catch (err) { next(err); }
});

module.exports = router;
