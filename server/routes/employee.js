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

const sharp   = require('sharp');

const storage = multer.memoryStorage();
const upload = multer({ storage });

const { enhanceText, enhanceJSON } = require('../ai');

const EDITABLE_FIELDS = [
  'name','education','position','contacts','experience',
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
    
    const newFilename = uuidv4() + '.jpeg';
    const filepath = path.join(uploadsDir, newFilename);
    
    await sharp(req.file.buffer)
      .jpeg({ quality: 85 })
      .toFile(filepath);

    res.json({ ok: true, photo: newFilename });
  } catch (err) { next(err); }
});

router.post('/correct-text', async (req, res) => {
  try {
    const { fields } = req.body;
    if (!fields || typeof fields !== 'object')
      return res.status(400).json({ error: 'Нет данных для проверки' });
    
    // We send the entire fields object (minus photo, email, etc. if we want to be safe)
    const safeFields = JSON.parse(JSON.stringify(fields));
    delete safeFields.photo;
    delete safeFields.email;
    delete safeFields.course_year;
    
    const corrected = await enhanceJSON(safeFields);
    res.json({ ok: true, corrected });
  } catch (e) {
    console.warn('AI Enhance Error:', e.message);
    res.status(500).json({ error: 'Ошибка проверки текста' });
  }
});

module.exports = router;
