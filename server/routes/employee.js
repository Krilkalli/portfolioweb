const express = require('express');
const router  = express.Router();
const { helpers } = require('../db');
const { notifyManagerNewSubmission, notifyEmployeeSubmitted } = require('../mailer');
const https = require('https');
const querystring = require('querystring');

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
    // Yandex Speller sometimes returns suggestions with context prefix (e.g. "- слово")
    // Strip leading non-alphanumeric/chars that don't match the original word
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
  'about','competencies','project_experience','certification',
];

router.get('/positions', (req, res) => {
  res.json({ positions: helpers.getPositions() });
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
    const newNorm = normalizeForComparison(fieldName, submitFields[fieldName]);
    const oldNorm = normalizeForComparison(fieldName, emp[fieldName]);
    if (newNorm !== oldNorm) {
      changes.push({ field_name: fieldName, old_value: storeValue(fieldName, emp[fieldName]), new_value: storeValue(fieldName, submitFields[fieldName]) });
    }
  }

  if (changes.length === 0)
    return res.json({ ok: true, changed: 0, message: 'Изменений не обнаружено' });

  helpers.submitChanges(emp.id, changes);

  const base = `${req.protocol}://${req.get('host')}`;
  notifyManagerNewSubmission(emp, base).catch(() => {});
  notifyEmployeeSubmitted(emp).catch(() => {});

  res.json({ ok: true, changed: changes.length });
});

router.post('/correct-text', async (req, res) => {
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

router.post('/:token/feedback', (req, res) => {
  const emp = helpers.getEmployeeByToken(req.params.token);
  if (!emp) return res.status(404).json({ error: 'Ссылка недействительна или не найдена' });
  const { rating, comment } = req.body;
  if (rating != null) {
    const r = Number(rating);
    if (r < 1 || r > 5) return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
  }
  helpers.saveFeedback(emp.id, rating ? Number(rating) : null, comment || '');
  res.json({ ok: true });
});

module.exports = router;
