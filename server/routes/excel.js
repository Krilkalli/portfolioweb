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

function requireAdmin(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.session.managerRole !== 'admin') return res.status(403).json({ error: 'Только главный администратор может выполнять полную замену данных' });
  next();
}

function extractField(line, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp('^\\s*' + escaped + '\\s*:\\s*(.*)$', 'i');
  const m = line.match(re);
  return m ? m[1].trim() : null;
}

function parseEducation(raw) {
  if (!raw || !String(raw).trim()) return [];
  const blocks = String(raw).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const entry = { institution: '', degree: '', specialty: '', year: '' };
    for (const line of block.split('\n')) {
      let v;
      if ((v = extractField(line, 'Учебное заведение')) !== null) entry.institution = v;
      else if ((v = extractField(line, 'Степень')) !== null) entry.degree = v;
      else if ((v = extractField(line, 'Специальность')) !== null) entry.specialty = v;
      else if ((v = extractField(line, 'Год окончания')) !== null) entry.year = v;
    }
    return entry;
  }).filter(e => e.institution || e.degree || e.specialty || e.year);
}

function parseContacts(raw) {
  const lines = String(raw || '').split('\n');
  let city = '', email = '';
  for (const line of lines) {
    let v;
    if ((v = extractField(line, 'Город')) !== null) city = v;
    else if ((v = extractField(line, 'Email')) !== null) email = v;
    else if (!email && line.includes('@')) email = line.trim();
    else if (!city && line.trim()) city = line.trim();
  }
  return { city, email };
}

function parseExperience(raw) {
  if (!raw || !String(raw).trim()) return { total: '', jobs: [] };
  const job = { company: '', position: '', period: '' };
  let total = '';
  for (const line of String(raw).split('\n')) {
    let v;
    if ((v = extractField(line, 'Общий стаж')) !== null) total = v;
    else if ((v = extractField(line, 'Компания')) !== null) job.company = v;
    else if ((v = extractField(line, 'Должность')) !== null) job.position = v;
    else if ((v = extractField(line, 'Период')) !== null) job.period = v;
  }
  const jobs = (job.company || job.position || job.period) ? [job] : [];
  return { total, jobs };
}

function parseProjects(raw) {
  if (!raw || !String(raw).trim()) return [];
  const blocks = String(raw).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const p = { period: '', position: '', role: '', team_size: '', client: '', project_description: '', task_description: '', technologies: '' };
    for (const line of block.split('\n')) {
      let v;
      if ((v = extractField(line, 'Период работы')) !== null) p.period = v;
      else if ((v = extractField(line, 'Должность')) !== null) p.position = v;
      else if ((v = extractField(line, 'Роль')) !== null) p.role = v;
      else if ((v = extractField(line, 'Размер команды')) !== null) p.team_size = v;
      else if ((v = extractField(line, 'Заказчик')) !== null) p.client = v;
      else if ((v = extractField(line, 'Описание проекта')) !== null) p.project_description = v;
      else if ((v = extractField(line, 'Задача, реализованная сотрудником')) !== null) p.task_description = v;
      else if ((v = extractField(line, 'Программные продукты / Технологии')) !== null) p.technologies = v;
    }
    return p;
  }).filter(p => p.period || p.position || p.role || p.client || p.project_description || p.task_description || p.technologies);
}

function parseAbout(raw) {
  const t = String(raw || '').trim();
  if (!t || /^уточнить$/i.test(t)) return '';
  return t;
}

function parseCompetencies(raw) {
  if (!raw) return '';
  return String(raw).split(/\n|;/).map(s => s.trim()).filter(Boolean).join('\n');
}

function cleanCertification(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/\n\s*\n\s*Обучающие курсы:\s*\n?\s*-\s*$/i, '');
  return t;
}

function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const key = String(h || '').trim();
    if (key && map[key] === undefined) map[key] = idx;
  });
  return map;
}

function resolveColumns(headerRow) {
  const map = buildHeaderMap(headerRow);
  const idx = {
    name: map['ФИО'],
    education: map['Образование'],
    position: map['Должность'],
    experience: map['Стаж работы'],
    about: map['Обо мне'],
    competencies: map['Компетенции'],
    project_experience: map['Проектный опыт'],
    certification: map['Сертификация 1С'],
    contacts: map['Контактные данные'],
  };
  if (idx.contacts === undefined) {
    const from = (idx.position ?? -1) + 1;
    const to = idx.experience !== undefined ? idx.experience : headerRow.length;
    for (let i = from; i < to; i++) {
      if (!String(headerRow[i] || '').trim()) { idx.contacts = i; break; }
    }
  }
  return idx;
}

router.post('/import', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const mode = req.body.mode || 'add';
    if (mode === 'replace' && req.session.managerRole !== 'admin') {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Только главный администратор может выполнять полную замену данных' });
    }

    const wb   = XLSX.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
    if (rows.length < 2) return res.status(400).json({ error: 'Файл пуст или не содержит данных' });

    const headerRow = rows[0];
    const col = resolveColumns(headerRow);
    if (col.name === undefined) {
      return res.status(400).json({ error: 'Не найдена колонка "ФИО" — проверьте формат файла' });
    }

    let removed = 0, imported = 0, updated = 0, skipped = 0;

    if (mode === 'replace') {
      removed = await helpers.deleteAllEmployees();
    }

    // В пределах одного файла тоже не должно быть двух строк с одинаковым email —
    // если файл содержит дубли, более поздняя строка "выигрывает" (перекрывает раннюю).
    const seenInFile = new Map(); // email(lower) -> index in `parsed`
    const parsed = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = String(row[col.name] ?? '').trim();
      if (!name) { skipped++; continue; }

      const { city, email } = parseContacts(col.contacts !== undefined ? row[col.contacts] : '');

      const data = {
        name,
        position: col.position !== undefined ? String(row[col.position] ?? '').trim() : '',
        education: parseEducation(col.education !== undefined ? row[col.education] : ''),
        experience: parseExperience(col.experience !== undefined ? row[col.experience] : ''),
        about: parseAbout(col.about !== undefined ? row[col.about] : ''),
        competencies: parseCompetencies(col.competencies !== undefined ? row[col.competencies] : ''),
        project_experience: parseProjects(col.project_experience !== undefined ? row[col.project_experience] : ''),
        certification: cleanCertification(col.certification !== undefined ? row[col.certification] : ''),
        city,
        email,
      };
      data.contacts = [city, email].filter(Boolean).join('\n');

      const emailKey = email ? email.trim().toLowerCase() : '';
      if (emailKey && seenInFile.has(emailKey)) {
        parsed[seenInFile.get(emailKey)] = data; // более поздняя строка перекрывает предыдущую с тем же email
      } else {
        if (emailKey) seenInFile.set(emailKey, parsed.length);
        parsed.push(data);
      }
    }

    for (const data of parsed) {
      if (mode === 'add') {
        const { action } = await helpers.upsertEmployeeByEmail(data);
        if (action === 'updated') updated++; else imported++;
      } else {
        await helpers.createEmployee(data);
        imported++;
      }
    }

    fs.unlinkSync(req.file.path);
    res.json({ ok: true, imported, updated, removed, skipped, total: rows.length - 1, mode });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: `Ошибка импорта: ${err.message}` });
  }
});

router.get('/export', requireAuth, async (req, res, next) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    function fmtEducation(edu) {
      if (typeof edu === 'string') return edu;
      if (Array.isArray(edu)) {
        return edu.map(e => [
          e.institution ? `Учебное заведение: ${e.institution}` : '',
          e.degree ? `Степень: ${e.degree}` : '',
          e.specialty ? `Специальность: ${e.specialty}` : '',
          e.year ? `Год окончания: ${e.year}` : '',
        ].filter(Boolean).join('\n')).join('\n\n');
      }
      return String(edu || '');
    }
    function fmtExperience(exp) {
      if (typeof exp === 'string') return exp;
      if (exp && typeof exp === 'object') {
        const lines = [];
        if (exp.total) lines.push('Общий стаж: ' + exp.total);
        if (Array.isArray(exp.jobs) && exp.jobs.length > 0) {
          for (const j of exp.jobs) {
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
    }
    function fmtProject(proj) {
      if (typeof proj === 'string') return proj;
      if (Array.isArray(proj)) {
        return proj.map(p => {
          const lines = [];
          if (p.period) lines.push('Период работы: ' + p.period);
          if (p.position) lines.push('Должность: ' + p.position);
          if (p.role) lines.push('Роль: ' + p.role);
          if (p.team_size) lines.push('Размер команды: ' + p.team_size);
          if (p.client) lines.push('Заказчик: ' + p.client);
          if (p.project_description) lines.push('Описание проекта: ' + p.project_description);
          if (p.task_description) lines.push('Задача, реализованная сотрудником: ' + p.task_description);
          if (p.technologies) lines.push('Программные продукты / Технологии: ' + p.technologies);
          return lines.join('\n');
        }).join('\n\n');
      }
      return String(proj || '');
    }

    const allEmps = await helpers.getAllEmployees();
    const data = allEmps.map(e => ({
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
  } catch (err) { next(err); }
});

module.exports = router;
