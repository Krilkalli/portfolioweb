const express = require('express');
const router  = express.Router();
const { helpers } = require('../db');
const { notifyManagerNewSubmission, notifyEmployeeSubmitted } = require('../mailer');

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
  emp.city = contactLines[0] || '';
  emp.email = contactLines.find(l => l.includes('@')) || '';
  emp.phone = contactLines.find(l => l.includes('+') || l.includes('(') || /^\d/.test(l)) || '';
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
  const contacts = [fields.city, fields.email, fields.phone].filter(Boolean).join('\n');
  const submitFields = {
    ...fields,
    contacts,
  };
  // Merge certification sub-fields into single text
  const certParts = [fields.certification, fields.courses ? 'Обучающие курсы: ' + fields.courses : '', fields.cert_date ? 'Дата актуализации: ' + fields.cert_date : ''].filter(Boolean);
  if (certParts.length) submitFields.certification = 'Сертификация 1С:\n' + certParts.join('\n\n');
  else submitFields.certification = '';

  const changes = [];
  for (const fieldName of EDITABLE_FIELDS) {
    if (submitFields[fieldName] === undefined) continue;
    const newValue = typeof submitFields[fieldName] === 'object' ? JSON.stringify(submitFields[fieldName]) : String(submitFields[fieldName]).trim();
    const oldValue = typeof emp[fieldName] === 'object' ? JSON.stringify(emp[fieldName]) : String(emp[fieldName] || '').trim();
    if (newValue !== oldValue) changes.push({ field_name: fieldName, old_value: oldValue, new_value: newValue });
  }

  if (changes.length === 0)
    return res.json({ ok: true, changed: 0, message: 'Изменений не обнаружено' });

  helpers.submitChanges(emp.id, changes);

  const base = `${req.protocol}://${req.get('host')}`;
  notifyManagerNewSubmission(emp, base).catch(() => {});
  notifyEmployeeSubmitted(emp).catch(() => {});

  res.json({ ok: true, changed: changes.length });
});

module.exports = router;
