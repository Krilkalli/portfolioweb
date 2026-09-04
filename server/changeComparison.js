function normalizeText(value) {
  return String(value ?? '').trim().replace(/\r\n/g, '\n');
}

function normalizeProjectPeriod(value) {
  return normalizeText(value).replace(/\s*-\s*/g, ' - ');
}

function normalizeDeep(value) {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalizeDeep(value[key])])
    );
  }
  return value;
}

function parseProjectExperience(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function canonicalProjectExperience(value) {
  return parseProjectExperience(value).map(rawItem => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const projectId = Number(item.project_id || 0) || null;
    const canonical = {
      project_id: projectId,
      period: normalizeProjectPeriod(item.period),
      position: normalizeText(item.position),
      role: normalizeText(item.role),
    };

    // Общие поля связанного проекта управляются РП/администратором и не должны
    // создавать изменение от имени сотрудника из-за служебной синхронизации.
    if (projectId) return canonical;

    return {
      ...canonical,
      project_name: normalizeText(item.project_name),
      team_size: normalizeText(item.team_size),
      client: normalizeText(item.client),
      project_description: normalizeText(item.project_description),
      task_description: normalizeText(item.task_description),
      functional_area: normalizeText(item.functional_area),
      technologies: normalizeText(item.technologies),
      functional_blocks: Array.isArray(item.functional_blocks)
        ? item.functional_blocks.map(normalizeText).filter(Boolean)
        : [],
    };
  }).filter(item => item.project_id || Object.entries(item).some(([key, value]) => {
    if (key === 'project_id') return false;
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }));
}

function normalizeCertification(value) {
  const parts = normalizeText(value).split(/\n\s*\n/);
  const certification = parts[0]?.replace(/^Сертификация 1С:?\s*/i, '').trim() || '';
  const courses = parts[1]?.replace(/^Обучающие курсы:?\s*/i, '').trim() || '';
  return { certification, courses };
}

function normalizeForComparison(fieldName, value) {
  if (value == null) return '';
  if (fieldName === 'certification') return JSON.stringify(normalizeCertification(value));
  if (fieldName === 'project_experience') return JSON.stringify(canonicalProjectExperience(value));
  if (typeof value === 'object') return JSON.stringify(normalizeDeep(value));
  return normalizeText(value);
}

module.exports = {
  canonicalProjectExperience,
  normalizeForComparison,
};
