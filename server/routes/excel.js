const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');
const fs      = require('fs');
const { helpers } = require('../db');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({ dest: uploadsDir });

function requireAuth(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  next();
}

const EXCEL_TO_DB = {
  'ФИО':                 'name',
  'Образование':         'education',
  'Должность':           'position',
  'Контактные данные':   'contacts',
  'Стаж работы':         'experience',
  'Обо мне':             'about',
  'Компетенции':         'competencies',
  'Проектный опыт':      'project_experience',
  'Сертификация 1С':     'certification',
};

// ── Импорт Excel / CSV ────────────────────────────────────────────────────────
// ВНИМАНИЕ: импорт полностью ЗАМЕНЯЕТ текущий список сотрудников данными из
// файла. Перед вставкой новых строк все существующие сотрудники удаляются
// (вместе с ними — их персональные ссылки и история pending_changes,
// т.к. на неё стоит ON DELETE CASCADE). Подтверждение показывается на клиенте
// (public/js/manager.js) перед отправкой файла на сервер.
router.post('/import', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  try {
    const wb   = XLSX.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const removed = helpers.deleteAllEmployees();

    let imported = 0, skipped = 0;
    for (const row of rows) {
      const data = {};
      for (const [col, field] of Object.entries(EXCEL_TO_DB))
        data[field] = String(row[col] || '').trim();
      if (!data.name) { skipped++; continue; }

      // Извлечь email из contacts
      const emailMatch = data.contacts.match(/[\w.+-]+@[\w.-]+\.\w+/);
      data.email = emailMatch ? emailMatch[0] : '';
      data.city  = data.contacts.split('\n')[0] || '';

      helpers.createEmployee(data);
      imported++;
    }

    fs.unlinkSync(req.file.path);
    res.json({ ok: true, imported, removed, skipped, total: rows.length });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: `Ошибка импорта: ${err.message}` });
  }
});

// ── Экспорт в Excel ───────────────────────────────────────────────────────────
router.get('/export', requireAuth, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  function fmtEducation(edu) {
    if (typeof edu === 'string') return edu;
    if (Array.isArray(edu)) {
      return edu.map(e => [e.institution, e.degree, e.specialty, e.year].filter(Boolean).join(',')).join(';');
    }
    return String(edu || '');
  }
  function fmtExperience(exp) {
    if (typeof exp === 'string') return exp;
    if (exp && typeof exp === 'object') {
      const lines = [];
      if (exp.total) lines.push('Общий стаж: ' + exp.total);
      if (Array.isArray(exp.jobs)) {
        for (const j of exp.jobs) {
          const parts = [j.company, j.position, j.period].filter(Boolean);
          if (parts.length) lines.push(parts.join(' — '));
        }
      }
      return lines.join('\n');
    }
    return String(exp || '');
  }
  function fmtProject(proj) {
    if (typeof proj === 'string') return proj;
    if (Array.isArray(proj)) {
      return proj.map(p => {
        const lines = [];
        if (p.period) lines.push('Период: ' + p.period);
        if (p.client) lines.push('Заказчик: ' + p.client);
        if (p.position) lines.push('Должность: ' + p.position);
        if (p.role) lines.push('Роль: ' + p.role);
        if (p.team_size) lines.push('Размер команды: ' + p.team_size);
        if (p.project_description) lines.push('Описание: ' + p.project_description);
        if (p.task_description) lines.push('Задачи: ' + p.task_description);
        if (p.technologies) lines.push('Технологии: ' + p.technologies);
        return lines.join('\n');
      }).join('\n\n');
    }
    return String(proj || '');
  }

  const data = helpers.getAllEmployees().map(e => ({
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
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    {wch:30},{wch:40},{wch:35},{wch:30},{wch:40},
    {wch:40},{wch:50},{wch:60},{wch:60},{wch:50},
  ];
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Сотрудники');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  const fn  = `portfolio_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`);
  res.send(buf);
});

module.exports = router;
