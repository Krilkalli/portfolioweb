const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { helpers } = require('../db');
const { notifyManagerNewSubmission, notifyEmployeeSubmitted } = require('../mailer');
const https = require('https');
const querystring = require('querystring');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage });

const SPELLER_URL = 'https://speller.yandex.net/services/spellservice.json/checkText';

function spellerRequest(text) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({ text, options: 0, lang: 'ru' });
    const req = https.request(SPELLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function applySpeller(text, errors) {
  if (!errors || errors.length === 0) return text;
  let result = text;
  const sorted = [...errors].sort((a, b) => b.pos - a.pos);
  for (const err of sorted) {
    if (!err.s || err.s.length === 0) continue;
    const word = err.word;
    let suggestion = err.s[0];
    if (!word[0] || /[-\s]/.test(suggestion[0]) && !/[-\s]/.test(word[0])) {
      suggestion = suggestion.replace(/^[^a-zA-Zа-яА-ЯёЁ0-9]+/, '');
    }
    const searchFrom = Math.max(0, err.pos - 2);
    const idx = result.indexOf(word, searchFrom);
    if (idx >= 0) {
      result = result.slice(0, idx) + suggestion + result.slice(idx + word.length);
    }
  }
  return result;
}

async function correctTextField(text) {
  if (!text || !text.trim()) return text;
  const errors = await spellerRequest(text);
  return applySpeller(text, errors);
}

function collectTextFields(fields) {
  const textFields = ['about', 'competencies', 'certification', 'courses'];
  const result = {};
  for (const key of textFields) {
    if (fields[key] !== undefined) result[key] = fields[key];
  }
  return result;
}

const EDITABLE_FIELDS = [
  'education','position','contacts','experience',
  'about','competencies','project_experience','certification','photo',
];

router.get('/positions', async (req, res, next) => {
  try {
    res.json({ positions: await helpers.getPositions() });
  } catch (err) { next(err); }
});

router.get('/position-competencies', async (req, res, next) => {
  try {
    res.json(await helpers.getPositionCompetencies());
  } catch (err) { next(err); }
});

router.get('/:token', async (req, res, next) => {
  try {
    const emp = await helpers.getEmployeeByToken(req.params.token);
    if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });
    const contactLines = (emp.contacts || '').split('\n').filter(l => l.trim());
    emp.city = emp.city || contactLines[0] || '';
    emp.email = emp.email || contactLines.find(l => l.includes('@')) || '';
    if (typeof emp.certification === 'string' && emp.certification) {
      const parts = emp.certification.split(/\n\s*\n/);
      emp.certification_1c = parts[0]?.replace(/^Сертификация 1С:?\s*/i, '').trim() || '';
      emp.courses = parts[1]?.replace(/^Обучающие курсы:?\s*/i, '').trim() || '';
      emp.cert_date = parts[2]?.replace(/^Дата актуализации:?\s*/i, '').trim() || '';
    }
    res.json({ ...emp, hasPending: await helpers.hasPendingForEmployee(emp.id) });
  } catch (err) { next(err); }
});

router.post('/:token/submit', async (req, res, next) => {
  try {
    const emp = await helpers.getEmployeeByToken(req.params.token);
    if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });

    const { fields } = req.body;
    if (!fields || typeof fields !== 'object')
      return res.status(400).json({ error: 'Нет данных для сохранения' });

    const contacts = [fields.city, fields.email].filter(Boolean).join('\n');
    const submitFields = { ...fields, contacts };
    const certParts = [fields.certification, fields.courses ? 'Обучающие курсы: ' + fields.courses : ''].filter(Boolean);
    if (certParts.length) submitFields.certification = 'Сертификация 1С:\n' + certParts.join('\n\n');
    else submitFields.certification = '';

    function normalizeForComparison(fieldName, value) {
      if (value == null) return '';
      if (fieldName === 'certification') {
        const parts = String(value).split(/\n\s*\n/);
        const cert = parts[0]?.replace(/^Сертификация 1С:?\s*/i, '').trim() || '';
        const courses = parts[1]?.replace(/^Обучающие курсы:?\s*/i, '').trim() || '';
        return JSON.stringify({ certification: cert, courses });
      }
      if (typeof value === 'object') {
        const trim = (v) => {
          if (typeof v === 'string') return v.trim();
          if (Array.isArray(v)) return v.map(trim);
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, trim(val)]));
          return v;
        };
        return JSON.stringify(trim(value));
      }
      return String(value).trim();
    }

    function storeValue(fieldName, value) {
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value || '').trim();
    }

    const changes = [];
    for (const fieldName of EDITABLE_FIELDS) {
      if (submitFields[fieldName] === undefined) continue;
      const newNorm = normalizeForComparison(fieldName, submitFields[fieldName]);
      const oldNorm = normalizeForComparison(fieldName, emp[fieldName]);
      if (newNorm !== oldNorm) {
        changes.push({ field_name: fieldName, old_value: storeValue(fieldName, emp[fieldName]), new_value: storeValue(fieldName, submitFields[fieldName]) });
      }
    }

    if (changes.length === 0)
      return res.json({ ok: true, changed: 0, message: 'Изменений не обнаружено' });

    await helpers.submitChanges(emp.id, changes);

    const base = `${req.protocol}://${req.get('host')}`;
    notifyManagerNewSubmission(emp, base).catch(() => {});
    notifyEmployeeSubmitted(emp).catch(() => {});

    res.json({ ok: true, changed: changes.length });
  } catch (err) { next(err); }
});

router.post('/correct-text', async (req, res, next) => {
  try {
    const { fields } = req.body;
    if (!fields || typeof fields !== 'object')
      return res.status(400).json({ error: 'Нет данных для проверки' });
    const corrected = {};
    for (const [key, value] of Object.entries(collectTextFields(fields))) {
      corrected[key] = await correctTextField(value);
    }
    res.json({ ok: true, corrected });
  } catch (e) {
    console.warn('Speller error:', e.message);
    res.status(500).json({ error: 'Ошибка проверки текста' });
  }
});

router.post('/:token/feedback', async (req, res, next) => {
  try {
    const emp = await helpers.getEmployeeByToken(req.params.token);
    if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });
    const { rating, comment } = req.body;
    if (rating != null) {
      const r = Number(rating);
      if (r < 1 || r > 5) return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
    }
    await helpers.saveFeedback(emp.id, rating ? Number(rating) : null, comment || '');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:token/photo', upload.single('photo'), async (req, res, next) => {
  try {
    const emp = await helpers.getEmployeeByToken(req.params.token);
    if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    res.json({ ok: true, photo: req.file.filename });
  } catch (err) { next(err); }
});

module.exports = router;
