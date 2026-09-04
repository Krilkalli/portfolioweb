const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { helpers } = require('../db');
const { composeProjectDescription } = require('../projectDescription');
const { normalizeForComparison } = require('../changeComparison');
const { notifyManagerNewSubmission, notifyEmployeeSubmitted } = require('../mailer');
const { getPublicBaseUrl } = require('../publicUrl');
const https = require('https');
const querystring = require('querystring');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const sharp   = require('sharp');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(String(file.mimetype || '').toLowerCase())) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'photo'));
    }
    callback(null, true);
  },
});

const { enhanceText, enhanceJSON } = require('../ai');

const EDITABLE_FIELDS = [
  'name','education','position','contacts','experience',
  'total_experience','about','competencies','project_experience','certification','photo',
];

function formatManagedProjectPeriod(project) {
  return [
    project?.start_period || '',
    project?.end_present ? 'настоящее время' : (project?.end_period || ''),
  ].filter(Boolean).join(' - ');
}

async function enforceManagedProjectFields(currentValue, submittedValue, employeeId = null) {
  const current = Array.isArray(currentValue) ? currentValue : [];
  const submittedInput = Array.isArray(submittedValue) ? submittedValue.map(item => ({ ...item })) : [];
  const lockedFields = ['team_size', 'project_name', 'client', 'project_description', 'functional_area'];
  const currentLockedById = new Map(current.filter(item => item?.project_id).map(item => [Number(item.project_id), item]));
  const submitted = submittedInput.map((item, index) => {
    const projectId = Number(item?.project_id || 0);
    const original = (projectId && currentLockedById.get(projectId)) || current[index] || null;
    const protectedItem = { ...item };
    for (const field of lockedFields) protectedItem[field] = original?.[field] || '';
    return protectedItem;
  });

  // Связанный с карточкой проект нельзя удалить из проектного опыта сотрудника.
  const submittedProjectIds = new Set(submitted.map(item => Number(item?.project_id || 0)).filter(Boolean));
  for (const item of current) {
    const projectId = Number(item?.project_id || 0);
    if (!projectId || submittedProjectIds.has(projectId)) continue;
    const sameProject = submitted.find(candidate => !candidate?.project_id &&
      String(candidate?.project_name || '').trim().toLowerCase() === String(item?.project_name || '').trim().toLowerCase() &&
      String(candidate?.client || '').trim().toLowerCase() === String(item?.client || '').trim().toLowerCase());
    if (sameProject) sameProject.project_id = projectId;
    else submitted.push({ ...item });
    submittedProjectIds.add(projectId);
  }

  const projectIds = [...new Set(submitted.map(item => Number(item?.project_id || 0)).filter(Boolean))];
  if (!projectIds.length) return submitted;
  const projects = await helpers.getProjectsByIds(projectIds);
  const projectsById = new Map(projects.map(project => [Number(project.id), project]));
  const currentById = new Map(current.filter(item => item?.project_id).map(item => [Number(item.project_id), item]));

  return submitted.map(item => {
    const projectId = Number(item?.project_id || 0);
    if (!projectId) return item;
    const project = projectsById.get(projectId);
    const saved = currentById.get(projectId) || {};
    if (!project) {
      return {
        ...item,
        project_id: projectId,
        period: saved.period || item.period || '',
        project_name: saved.project_name || item.project_name || '',
        team_size: saved.team_size || item.team_size || '',
        client: saved.client || item.client || '',
        project_description: saved.project_description || item.project_description || '',
        task_description: saved.task_description || item.task_description || '',
        functional_area: saved.functional_area || item.functional_area || '',
        technologies: saved.technologies || item.technologies || '',
        functional_blocks: Array.isArray(saved.functional_blocks) ? saved.functional_blocks : (item.functional_blocks || []),
      };
    }
    const functionalBlocks = Array.isArray(project.functional_blocks) ? project.functional_blocks : [];
    const projectMember = (project.team_members || []).find(member => Number(member.employee_id || member.id || 0) === Number(employeeId || 0));
    const functionalArea = Array.isArray(projectMember?.functional_areas) && projectMember.functional_areas.length
      ? projectMember.functional_areas.join(', ')
      : (project.functional_area || '');
    const submittedPeriod = String(item?.period || '').trim();
    const employeeChangedPeriod = submittedPeriod !== String(saved?.period || '').trim();
    const periodOverridden = Boolean(saved?.period_overridden) || employeeChangedPeriod;
    return {
      ...item,
      project_id: projectId,
      period: periodOverridden ? submittedPeriod : formatManagedProjectPeriod(project),
      period_overridden: periodOverridden,
      project_name: project.code_name || project.title || '',
      team_size: String(project.team_size || ''),
      client: project.industry_description || project.legal_customer_name || project.customer || '',
      project_description: composeProjectDescription(project.description, functionalBlocks),
      task_description: '',
      functional_area: functionalArea,
      technologies: project.technologies || '',
      functional_blocks: functionalBlocks,
    };
  });
}
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
    if (Array.isArray(emp.project_experience)) {
      emp.project_experience = await enforceManagedProjectFields(emp.project_experience, emp.project_experience, emp.id);
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
    if (submitFields.experience && typeof submitFields.experience === 'object') {
      submitFields.experience = { ...submitFields.experience, total: emp.experience?.total || '' };
    }
    if (Array.isArray(submitFields.project_experience)) {
      submitFields.project_experience = await enforceManagedProjectFields(emp.project_experience, submitFields.project_experience, emp.id);
    }
    const certParts = [fields.certification, fields.courses ? 'Обучающие курсы: ' + fields.courses : ''].filter(Boolean);
    if (certParts.length) submitFields.certification = 'Сертификация 1С:\n' + certParts.join('\n\n');
    else submitFields.certification = '';

    function storeValue(fieldName, value) {
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value || '').trim();
    }

    const changes = [];
    for (const fieldName of EDITABLE_FIELDS) {
      if (submitFields[fieldName] === undefined) continue;
      const newNorm = normalizeForComparison(fieldName, submitFields[fieldName]);
      const oldValue = fieldName === 'total_experience' ? (emp.experience?.total || '') : emp[fieldName];
      const oldNorm = normalizeForComparison(fieldName, oldValue);
      if (newNorm !== oldNorm) {
        changes.push({ field_name: fieldName, old_value: storeValue(fieldName, oldValue), new_value: storeValue(fieldName, submitFields[fieldName]) });
      }
    }

    if (changes.length === 0)
      return res.json({ ok: true, changed: 0, message: 'Изменений не обнаружено' });

    if (req.query.mode === 'manager') {
      const role = req.session?.managerRole || '';
      if (!req.session?.isManager || !['admin', 'scrum', 'leader'].includes(role)) {
        return res.status(403).json({ error: 'Режим менеджера требует авторизации' });
      }
      const updates = {};
      for (const c of changes) {
        updates[c.field_name] = submitFields[c.field_name];
      }
      if (updates.contacts !== undefined) {
        updates.city = fields.city || '';
        updates.email = fields.email || '';
      }
      await helpers.updateEmployee(emp.id, updates);
      return res.json({ ok: true, changed: changes.length, message: 'Изменения мгновенно применены (права менеджера)' });
    }

    await helpers.submitChanges(emp.id, changes);

    const base = getPublicBaseUrl(req);
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
      if (isNaN(r) || r < 1 || r > 5) return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
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
    if (!req.session?.isManager) {
      return res.status(401).json({ error: 'Требуется авторизация менеджера' });
    }
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
