const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { helpers } = require('../db');
const { notifyManagerNewSubmission, notifyEmployeeSubmitted, notifyManagerFeedback } = require('../mailer');
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

const { enhanceText, enhanceJSON } = require('../ai');

const EDITABLE_FIELDS = [
  'education','position','contacts','experience',
  'about','competencies','project_experience','certification','photo',
];
router.get('/positions', (req, res) => {
  res.json({ positions: helpers.getPositions() });
});

router.get('/position-competencies', (req, res) => {
  res.json(helpers.getPositionCompetencies());
});

router.get('/:token', (req, res) => {
  const emp = helpers.getEmployeeByToken(req.params.token);
  if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });
  // Parse contacts into city/email/phone
  const contactLines = (emp.contacts || '').split('\n').filter(l => l.trim());
  emp.city = emp.city || contactLines[0] || '';
  emp.email = emp.email || contactLines.find(l => l.includes('@')) || '';
  // Parse certification into sub-fields
  if (typeof emp.certification === 'string' && emp.certification) {
    const parts = emp.certification.split(/\n\s*\n/);
    emp.certification_1c = parts[0]?.replace(/^Сертификация 1С:?\s*/i, '').trim() || '';
    emp.courses = parts[1]?.replace(/^Обучающие курсы:?\s*/i, '').trim() || '';
    emp.cert_date = parts[2]?.replace(/^Дата актуализации:?\s*/i, '').trim() || '';
  }
  res.json({ ...emp, hasPending: helpers.hasPendingForEmployee(emp.id) });
});

router.post('/:token/submit', async (req, res) => {
  const emp = helpers.getEmployeeByToken(req.params.token);
  if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });

  const { fields } = req.body;
  if (!fields || typeof fields !== 'object')
    return res.status(400).json({ error: 'Нет данных для сохранения' });

  // Merge city/email/phone into contacts
  const contacts = [fields.city, fields.email].filter(Boolean).join('\n');
  const submitFields = {
    ...fields,
    contacts,
  };
  // Merge certification sub-fields into single text
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
    if (fieldName === 'photo') continue; // photos saved directly
    const newNorm = normalizeForComparison(fieldName, submitFields[fieldName]);
    const oldNorm = normalizeForComparison(fieldName, emp[fieldName]);
    if (newNorm !== oldNorm) {
      changes.push({ field_name: fieldName, old_value: storeValue(fieldName, emp[fieldName]), new_value: storeValue(fieldName, submitFields[fieldName]) });
    }
  }

  // Save photo directly if changed
  if (submitFields.photo !== undefined && submitFields.photo !== (emp.photo || '')) {
    helpers.updateEmployee(emp.id, { photo: submitFields.photo });
  }

  if (changes.length === 0)
    return res.json({ ok: true, changed: 0, message: 'Изменений не обнаружено' });

  helpers.submitChanges(emp.id, changes);

  const base = `${req.protocol}://${req.get('host')}`;
  notifyManagerNewSubmission(emp, base).catch(() => {});
  notifyEmployeeSubmitted(emp).catch(() => {});

  res.json({ ok: true, changed: changes.length });
});

router.post('/:token/feedback', (req, res) => {
  const emp = helpers.getEmployeeByToken(req.params.token);
  if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });
  const { rating, comment } = req.body;
  if (rating != null) {
    const r = Number(rating);
    if (r < 1 || r > 5) return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
  }
  helpers.saveFeedback(emp.id, rating ? Number(rating) : null, comment || '');
  const feedback = { rating: rating ? Number(rating) : null, comment: comment || '' };
  notifyManagerFeedback(emp, feedback).catch(() => {});
  res.json({ ok: true });
});

// ── Загрузить фото ────────────────────────────────────────────────────────────
router.post('/:token/photo', upload.single('photo'), (req, res) => {
  const emp = helpers.getEmployeeByToken(req.params.token);
  if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });

  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  // Удаляем старое фото, если есть
  if (emp.photo) {
    const oldPath = path.join(uploadsDir, emp.photo);
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) { console.error('Ошибка удаления старого фото', e); }
    }
  }

  const newPhotoName = req.file.filename;
  helpers.updateEmployee(emp.id, { photo: newPhotoName });

  res.json({ ok: true, photo: newPhotoName });
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
