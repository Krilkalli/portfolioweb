(function initEmployeeSearch(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmployeeSearch = api;
})(typeof window !== 'undefined' ? window : globalThis, function createEmployeeSearch() {
  function normalizeText(value) {
    return String(value ?? '')
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9+#.]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function queryTerms(query) {
    return [...new Set(normalizeText(query).split(' ').filter(Boolean))];
  }

  function uniqueText(values) {
    const seen = new Set();
    return values.map(value => String(value || '').trim()).filter(value => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function splitValues(value) {
    if (Array.isArray(value)) return value.flatMap(splitValues);
    return String(value || '').split(/[\n;,]+/).map(item => item.trim()).filter(Boolean);
  }

  function projectSources(projectExperience) {
    if (typeof projectExperience === 'string') {
      return projectExperience.trim() ? [{ label: 'Проектный опыт', values: splitValues(projectExperience) }] : [];
    }
    if (!Array.isArray(projectExperience)) return [];

    return projectExperience.map(project => {
      if (!project || typeof project !== 'object') return null;
      const label = String(project.project_name || project.title || 'Проектный опыт').trim();
      const values = uniqueText([
        ...splitValues(project.task_description),
        ...splitValues(project.functional_blocks),
        ...splitValues(project.functional_area),
        ...splitValues(project.role),
        ...splitValues(project.position),
        ...splitValues(project.technologies),
        ...splitValues(project.project_description),
        ...splitValues(project.client),
        ...splitValues(project.period),
        label,
      ]);
      return { label, values };
    }).filter(Boolean);
  }

  function experienceSources(employee) {
    const sources = [];
    const competencies = splitValues(employee?.competencies);
    if (competencies.length) sources.push({ label: 'Компетенции', values: competencies });
    return sources.concat(projectSources(employee?.project_experience));
  }

  function employeeSearchText(employee) {
    const profile = [employee?.name, employee?.position, employee?.city, employee?.email];
    const experience = experienceSources(employee).flatMap(source => [source.label, ...source.values]);
    return normalizeText([...profile, ...experience].join(' '));
  }

  function matchesEmployee(employee, query) {
    const terms = queryTerms(query);
    if (!terms.length) return true;
    const haystack = employeeSearchText(employee);
    return terms.every(term => haystack.includes(term));
  }

  function getExperienceMatches(employee, query, limit = 3) {
    const terms = queryTerms(query);
    if (!terms.length) return [];
    const matches = [];
    for (const source of experienceSources(employee)) {
      const relevant = source.values.filter(value => {
        const text = normalizeText(value);
        return terms.some(term => text.includes(term));
      });
      const labelMatches = terms.some(term => normalizeText(source.label).includes(term));
      if (!relevant.length && !labelMatches) continue;
      matches.push({
        label: source.label,
        details: uniqueText(relevant).slice(0, 2),
      });
      if (matches.length >= limit) break;
    }
    return matches;
  }

  return { normalizeText, queryTerms, employeeSearchText, matchesEmployee, getExperienceMatches };
});
