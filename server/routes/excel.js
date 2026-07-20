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

function parseBlockArrayFlexible(raw, labelsMap) {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  
  const labelKeys = Object.keys(labelsMap);
  const escapedLabels = labelKeys.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(' + escapedLabels.join('|') + ')\\s*:\\s*', 'gi');
  
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      const val = text.substring(lastIndex, match.index).trim();
      if (tokens.length > 0) tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + val;
    }
    tokens.push({ key: labelsMap[match[1].toLowerCase().trim()], val: '' });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length && tokens.length > 0) {
    tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + text.substring(lastIndex).trim();
  }
  
  const entries = [];
  let currentEntry = null;
  
  for (const t of tokens) {
    if (currentEntry && currentEntry[t.key] !== undefined) currentEntry = null;
    if (!currentEntry) {
      currentEntry = {};
      entries.push(currentEntry);
    }
    currentEntry[t.key] = t.val;
  }
  
  return entries.filter(e => Object.values(e).some(val => typeof val === 'string' && val.trim() !== ''));
}

function parseEducation(raw) {
  const map = {
    'учебное заведение': 'institution',
    'степень': 'degree',
    'специальность': 'specialty',
    'год окончания': 'year',
    'год': 'year'
  };
  const entries = parseBlockArrayFlexible(raw, map);
  return entries.map(e => ({
    institution: e.institution || '',
    degree: e.degree || '',
    specialty: e.specialty || '',
    year: e.year || ''
  }));
}

function parseContacts(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  let city = '', email = '';
  const cMatch = text.match(/Город\s*:\s*([^\n]+)/i) || text.match(/Город\s*:\s*([^ ]+)/i);
  if (cMatch) city = cMatch[1].trim();
  const eMatch = text.match(/Email\s*:\s*([^\n]+)/i) || text.match(/Email\s*:\s*([^ ]+)/i);
  if (eMatch) email = eMatch[1].trim();
  
  if (!email) {
    const parts = text.split(/\s+/);
    const em = parts.find(p => p.includes('@'));
    if (em) email = em.trim();
  }
  if (!city && !text.includes(':')) {
    const lines = text.split('\n');
    if (lines[0] && !lines[0].includes('@')) city = lines[0].trim();
  }
  return { city, email, contactsText: text.trim() };
}

function parseExperience(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return { total: '', jobs: [] };

  const labelsMap = {
    'общий стаж': 'total',
    'стаж работы в 1с': 'ignore',
    'компания': 'company',
    'должность': 'position',
    'период': 'period'
  };
  
  const labelKeys = Object.keys(labelsMap);
  const escapedLabels = labelKeys.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(' + escapedLabels.join('|') + ')\\s*:\\s*', 'gi');
  
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      const val = text.substring(lastIndex, match.index).trim();
      if (tokens.length > 0) tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + val;
    }
    tokens.push({ key: labelsMap[match[1].toLowerCase().trim()], val: '' });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length && tokens.length > 0) {
    tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + text.substring(lastIndex).trim();
  }
  
  let total = '';
  const jobs = [];
  let currentJob = null;
  
  for (const t of tokens) {
    if (t.key === 'total') {
      total = t.val;
    } else if (t.key === 'ignore') {
      continue;
    } else {
      if (currentJob && currentJob[t.key] !== undefined) currentJob = null;
      if (!currentJob) {
        currentJob = {};
        jobs.push(currentJob);
      }
      currentJob[t.key] = t.val;
    }
  }
  
  return { total, jobs: jobs.map(j => ({
    company: j.company || '',
    position: j.position || '',
    period: j.period || ''
  })).filter(j => j.company || j.position || j.period) };
}

function parseProjects(raw) {
  const map = {
    'период работы': 'period',
    'должность': 'position',
    'роль': 'role',
    'размер команды': 'team_size',
    'заказчик': 'client',
    'описание проекта': 'project_description',
    'задача, реализованная сотрудником': 'task_description',
    'задача': 'task_description',
    'программные продукты / технологии': 'technologies',
    'программные продукты': 'technologies'
  };
  const entries = parseBlockArrayFlexible(raw, map);
  return entries.map(e => ({
    period: e.period || '',
    position: e.position || '',
    role: e.role || '',
    team_size: e.team_size || '',
    client: e.client || '',
    project_description: e.project_description || '',
    task_description: e.task_description || '',
    technologies: e.technologies || ''
  }));
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
    const mode = req.body.mode || 'replace';
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

    function normalizeContacts(raw) {
      return String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    let removed = 0, imported = 0, updated = 0, skipped = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = String(row[col.name] ?? '').trim();
      if (!name) { skipped++; continue; }

      const { city, email, contactsText } = parseContacts(col.contacts !== undefined ? row[col.contacts] : '');

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
      data.contacts = contactsText || [city, email].filter(Boolean).join('\n');

      const resAct = await helpers.upsertEmployee(data);
      if (resAct === 'updated') updated++;
      else imported++;
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
        return lines.join('\n\n');
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
