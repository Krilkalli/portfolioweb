function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  t.innerHTML = `<span>${icons[type]}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
}

function initials(name) {
  return (name || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const FIELD_NAMES = {
  education: 'Образование',
  position: 'Должность',
  contacts: 'Контакты',
  total_experience: 'Общий стаж',
  experience: 'Стаж работы',
  about: 'Обо мне',
  competencies: 'Компетенции',
  project_experience: 'Проектный опыт',
  certification: 'Сертификация',
  course_name: 'Наименование курса',
  course_year: 'Год прохождения курса',
  photo: 'Фото',
};

let originalValues = {};
let token = null;
let employee = null;
let isViewMode = false;
let selectedRating = 0;
let pendingSubmitFields = null;
let managerUser = null; // if logged in as manager

function getAllChecklistItems() {
  return Array.from(document.querySelectorAll('#competencyChecklist input[type="checkbox"]')).map(c => c.value);
}

// ─── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  if (saved === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('themeToggle').textContent = '☀️';
  }
}
document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.getElementById('themeToggle').textContent = isLight ? '☀️' : '🌙';
});

// ─── Templates ──────────────────────────────────────────────────────────────
function toggleTemplate(field) {
  const panel = document.getElementById('template_' + field);
  if (panel) panel.classList.toggle('visible');
}
function setupTemplateTriggers() {
  const templateFields = ['about', 'competencies', 'project_experience'];
  document.querySelectorAll('.form-control').forEach(el => {
    const field = el.id.replace('f_', '');
    if (templateFields.includes(field) && document.getElementById('template_' + field)) {
      el.addEventListener('focus', () => {
        const panel = document.getElementById('template_' + field);
        if (panel) panel.classList.add('visible');
      });
      el.addEventListener('blur', () => {
        setTimeout(() => {
          const panel = document.getElementById('template_' + field);
          if (panel && !panel.matches(':hover')) panel.classList.remove('visible');
        }, 200);
      });
    }
  });
  document.querySelectorAll('.template-panel').forEach(p => {
    p.addEventListener('mouseenter', () => p.classList.add('visible'));
    p.addEventListener('mouseleave', () => p.classList.remove('visible'));
  });
}

// ─── Competency Checklist ──────────────────────────────────────────────────
const COMPETENCY_GROUPS = [
  { label: 'Архитектор', items: [
    'Формирование функциональной архитектуры системы',
    'Проектирование интеграционных решений (ESB, HTTP, RabbitMQ)',
    'Проектирование миграции данных из legacy-систем',
    'Управление требованиями на уровне бизнес-целей',
    'Организация приемки и сдачи функциональности',
    'Оценка трудоемкости и ресурсное планирование',
    'Экспертное владение 1С:ERP / 1С:ЗУП КОРП',
    'Знание отраслевого учета (МСФО, регламентированный учет)',
    'Стратегическое видение проекта',
    'Управление командой аналитиков и разработчиков',
    'Презентация решений перед заказчиком',
    'Управление функциональными и техническими рисками',
  ]},
  { label: 'Разработчик', items: [
    'Знание объектов метаданных, управляемых форм, языка запросов, СКД',
    'Понимание клиент-серверной архитектуры и транзакций',
    'Опыт модификации типовых конфигураций (ERP, УТ, ДО, БП, ЗУП)',
    'Модификация через расширения и подписки на события',
    'Веб-сервисы и HTTP-сервисы (SOAP/REST)',
    'Обмены данными XML/JSON',
    'Работа с Git, SVN',
    'Автотестирование (Vanessa Automation) / статанализ (SonarQube, BSL LS)',
    'Написание читаемого, структурированного кода',
    'Работа с чужим кодом, диагностика ошибок',
    'Самостоятельный анализ задач и оценка сроков',
    'Функциональное тестирование и регресс по чек-листу',
  ]},
  { label: 'Аналитик', items: [
    'Проведение обследования и интервьюирование пользователей',
    'Анализ бизнес-процессов (AS IS / TO BE)',
    'Моделирование в нотациях BPMN, EPC',
    'GAP-анализ',
    'Сбор и формализация требований',
    'Разработка проектной документации (ТЗ, ЧТЗ, инструкции, ПМИ)',
    'Знание бухгалтерского, налогового, кадрового учета',
    'Постановка задач разработчикам',
    'Участие в тестировании функционала',
    'Навыки деловой переписки и коммуникации',
    'Обучение и консультирование пользователей',
    'Написание базовых SQL/1С-запросов',
  ]},
];

function buildCompetencyChecklist(positionOverride) {
  const container = document.getElementById('competencyChecklist');
  if (!container) return;
  container.innerHTML = '';

  // If position has custom competencies, show only those
  const pos = positionOverride || document.getElementById('f_position')?.value || '';
  const posComps = positionCompetencies[pos];
  if (posComps && posComps.length > 0) {
    const label = document.createElement('div');
    label.style.cssText = 'grid-column:1/-1;font-weight:600;font-size:0.85rem;color:var(--text-primary);margin-bottom:4px;';
    label.textContent = pos;
    container.appendChild(label);
    posComps.forEach(item => {
      const wrapper = document.createElement('label');
      wrapper.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:0.82rem;color:var(--text-secondary);cursor:pointer;padding:2px 0;line-height:1.4;';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = item;
      cb.style.cssText = 'margin-top:3px;accent-color:var(--accent);';
      cb.addEventListener('change', updateCompetencies);
      wrapper.appendChild(cb);
      wrapper.appendChild(document.createTextNode(' ' + item));
      container.appendChild(wrapper);
    });
    return;
  }

  // Fallback: show default competency groups
  COMPETENCY_GROUPS.forEach(group => {
    const label = document.createElement('div');
    label.className = 'competency-group-label';
    label.style.cssText = 'grid-column:1/-1;font-weight:600;font-size:0.85rem;color:var(--text-primary);margin-top:8px;margin-bottom:4px;';
    label.textContent = group.label;
    container.appendChild(label);
    group.items.forEach(item => {
      const wrapper = document.createElement('label');
      wrapper.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:0.82rem;color:var(--text-secondary);cursor:pointer;padding:2px 0;line-height:1.4;';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = item;
      cb.style.cssText = 'margin-top:3px;accent-color:var(--accent);';
      cb.addEventListener('change', updateCompetencies);
      wrapper.appendChild(cb);
      wrapper.appendChild(document.createTextNode(' ' + item));
      container.appendChild(wrapper);
    });
  });
}

function updateCompetencies() {
  const allItems = getAllChecklistItems();
  const checked = Array.from(document.querySelectorAll('#competencyChecklist input:checked')).map(c => c.value);
  const ta = document.getElementById('f_competencies');
  if (!ta) return;
  const lines = ta.value.split('\n').filter(l => l.trim());
  const kept = lines.filter(line => !allItems.includes(line.trim()) || checked.includes(line.trim()));
  ta.value = [...new Set([...kept, ...checked])].join('\n');
  trackChanges();
  autoResize(ta);
}

function syncChecklist(text) {
  document.querySelectorAll('#competencyChecklist input[type="checkbox"]').forEach(cb => {
    cb.checked = (text || '').split('\n').map(l => l.trim()).includes(cb.value);
  });
}

function confirmRemoveEntry(btn, className) {
  if (!confirm('Удалить эту запись?')) return;
  btn.closest('.' + className)?.remove();
  trackChanges();
}

function projectTitle(data) {
  return data?.client?.trim() || data?.project_description?.trim()?.slice(0, 80) || data?.position?.trim() || 'Новый проект';
}
function jobTitle(data) {
  return data?.company?.trim() || data?.position?.trim() || 'Новое место работы';
}
function eduTitle(data) {
  return data?.institution?.trim() || 'Новое учебное заведение';
}
function updateAccordionTitle(entry, selector, titleFn) {
  const summary = entry.querySelector(selector);
  if (!summary) return;
  if (entry.classList.contains('proj-entry')) {
    summary.textContent = projectTitle({
      client: entry.querySelector('.proj-client')?.value.trim(),
      project_description: entry.querySelector('.proj-descr')?.value.trim(),
      position: entry.querySelector('.proj-position')?.value.trim(),
    });
  } else if (entry.classList.contains('job-entry')) {
    summary.textContent = jobTitle({
      company: entry.querySelector('.job-company')?.value.trim(),
      position: entry.querySelector('.job-position')?.value.trim(),
    });
  } else {
    summary.textContent = eduTitle({ institution: entry.querySelector('.edu-institution')?.value.trim() });
  }
}

function viewValue(text) {
  const val = (text || '').trim();
  return val ? `<div class="view-field-value">${escHtml(val)}</div>` : '<div class="view-empty">—</div>';
}
function viewField(label, text) {
  return `<div class="view-field"><div class="view-field-label">${escHtml(label)}</div>${viewValue(text)}</div>`;
}
function renderAccordionView(items, getTitle, getBody, emptyText) {
  if (!items.length) return `<div class="view-empty">${emptyText}</div>`;
  return items.map(item =>
    `<details class="accordion-entry"><summary>${escHtml(getTitle(item))}</summary><div class="accordion-body">${getBody(item)}</div></details>`
  ).join('');
}

// ─── Education Entries ─────────────────────────────────────────────────────
function addEducationEntry(data) {
  const c = document.getElementById('educationContainer');
  const e = document.createElement('details');
  e.className = 'edu-entry accordion-entry';
  e.open = !data?.institution;
  const v = (s) => (/^уточнить$/i.test(s || '') ? '' : escHtml(s || ''));
  e.innerHTML = `
    <summary class="edu-summary">${escHtml(eduTitle(data))}</summary>
    <div class="accordion-body">
      <button type="button" class="remove-btn" style="position:absolute;top:8px;right:8px;" onclick="confirmRemoveEntry(this,'edu-entry')">✕</button>
      <div class="form-group"><label class="form-label">Учебное заведение</label>
        <input type="text" class="form-control edu-institution" placeholder="Полное наименование вуза" value="${v(data?.institution)}"></div>
      <div class="form-group"><label class="form-label">Квалификация / Ученая степень</label>
        <input type="text" class="form-control edu-degree" placeholder="магистр, бакалавр, специалист" value="${v(data?.degree)}"></div>
      <div class="form-group"><label class="form-label">Направление / Специальность</label>
        <input type="text" class="form-control edu-specialty" placeholder="Направление подготовки" value="${v(data?.specialty)}"></div>
      <div class="form-group"><label class="form-label">Год окончания</label>
        <input type="text" class="form-control edu-year" placeholder="2024" value="${v(data?.year)}"></div>
    </div>`;
  c.appendChild(e);
  e.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { updateAccordionTitle(e, '.edu-summary'); trackChanges(); }));
}

function loadEducationData(arr) {
  document.getElementById('educationContainer').innerHTML = '';
  if (Array.isArray(arr) && arr.length > 0) {
    arr.forEach(d => addEducationEntry(d));
  } else if (typeof arr === 'string' && arr.trim()) {
    // Single string — try delimited format (inst,deg,spec,year;inst2,...)
    const text = arr.trim();
    if (text.includes(';') || text.includes(',')) {
      const entries = text.split(';').filter(Boolean);
      entries.forEach(e => {
        const p = e.split(',');
        addEducationEntry({ institution: p[0]?.trim() || '', degree: p[1]?.trim() || '', specialty: p[2]?.trim() || '', year: p[3]?.trim() || '' });
      });
    } else {
      addEducationEntry({ institution: text, degree: '', specialty: '', year: '' });
    }
  } else {
    addEducationEntry({ institution: '', degree: '', specialty: '', year: '' });
  }
}

function getEducationData() {
  return Array.from(document.querySelectorAll('.edu-entry')).map(el => ({
    institution: el.querySelector('.edu-institution').value.trim(),
    degree: el.querySelector('.edu-degree').value.trim(),
    specialty: el.querySelector('.edu-specialty').value.trim(),
    year: el.querySelector('.edu-year').value.trim(),
  })).filter(e => e.institution || e.degree || e.specialty || e.year);
}

// // ─── Job Entries (Experience) ──────────────────────────────────────────────
// function addJobEntry(data) {
//   const c = document.getElementById('jobContainer');
//   const e = document.createElement('details');
//   e.className = 'job-entry accordion-entry';
//   e.open = !data?.company;
//   e.innerHTML = `
//     <summary class="job-summary">${escHtml(jobTitle(data))}</summary>
//     <div class="accordion-body">
//       <button type="button" class="remove-btn" style="position:absolute;top:8px;right:8px;" onclick="confirmRemoveEntry(this,'job-entry')">✕</button>
//       <div class="form-group"><label class="form-label">Компания</label>
//         <input type="text" class="form-control job-company" placeholder="Наименование компании" value="${escHtml(data?.company||'')}"></div>
//       <div class="form-group"><label class="form-label">Должность</label>
//         <input type="text" class="form-control job-position" placeholder="Должность" value="${escHtml(data?.position||'')}"></div>
//       <div class="form-group"><label class="form-label">Период работы</label>
//         <input type="text" class="form-control job-period" placeholder="ММ.ГГГГ - ММ.ГГГГ" value="${escHtml(data?.period||'')}"></div>
//     </div>`;
//   c.appendChild(e);
//   e.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { updateAccordionTitle(e, '.job-summary'); trackChanges(); }));
// }
function addJobEntry(data) {
  const c = document.getElementById('jobContainer');
  const e = document.createElement('details');
  e.className = 'job-entry accordion-entry';
  e.open = !data?.company;
  e.innerHTML = `
    <summary class="job-summary">${escHtml(jobTitle(data))}</summary>
    <div class="accordion-body">
      <button type="button" class="remove-btn" style="position:absolute;top:8px;right:8px;" onclick="confirmRemoveEntry(this,'job-entry')">✕</button>
      <div class="form-group"><label class="form-label">Компания</label>
        <input type="text" class="form-control job-company" placeholder="Наименование компании" value="${escHtml(data?.company||'')}"></div>
      <div class="form-group"><label class="form-label">Должность</label>
        <input type="text" class="form-control job-position" placeholder="Должность" value="${escHtml(data?.position||'')}"></div>
      <div class="form-group"><label class="form-label">Период работы</label>
        <input type="text" class="form-control job-period" placeholder="ММ.ГГГГ - ММ.ГГГГ" value="${escHtml(data?.period||'')}">
        <span style="font-size:0.7rem;color:var(--text-muted);">Пример: 01.2024 - 06.2024</span></div>
    </div>`;
  c.appendChild(e);
  
  // === НОВЫЙ КОД: маска для периода ===
  const periodInput = e.querySelector('.job-period');
  if (periodInput) {
    maskPeriod(periodInput);
  }
  
  e.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { 
    updateAccordionTitle(e, '.job-summary'); 
    trackChanges(); 
  }));
}
function loadJobData(exp) {
  document.getElementById('jobContainer').innerHTML = '';
  const totalEl = document.getElementById('f_total_experience');
  // Если "Стаж работы" пришёл из Excel-импорта как обычный текст (не JSON-объект
  // {total, jobs}) — переносим его в поле "Общий стаж", чтобы данные не терялись.
  if (typeof exp === 'string' && exp.trim()) {
    addJobEntry({ company: '', position: '', period: '' });
    if (totalEl) totalEl.value = exp.trim();
    return;
  }
  const jobs = exp?.jobs || [];
  if (Array.isArray(jobs) && jobs.length > 0) jobs.forEach(d => addJobEntry(d));
  else addJobEntry({ company: '', position: '', period: '' });
  if (totalEl) totalEl.value = exp?.total || '';
}

function getJobData() {
  return {
    total: document.getElementById('f_total_experience')?.value.trim() || '',
    jobs: Array.from(document.querySelectorAll('.job-entry')).map(el => ({
      company: el.querySelector('.job-company').value.trim(),
      position: el.querySelector('.job-position').value.trim(),
      period: el.querySelector('.job-period').value.trim(),
    })).filter(j => j.company || j.position || j.period),
  };
}

function addProjectEntry(data) {
  const c = document.getElementById('projectExperienceContainer');
  const e = document.createElement('details');
  e.className = 'proj-entry accordion-entry';
  e.open = !(data?.client || data?.project_description);
  e.innerHTML = `
    <summary class="proj-summary">${escHtml(projectTitle(data))}</summary>
    <div class="accordion-body">
      <button type="button" class="remove-btn" style="position:absolute;top:8px;right:8px;" onclick="confirmRemoveEntry(this,'proj-entry')">✕</button>
      <div class="form-group"><label class="form-label">Период работы на проекте</label>
        <input type="text" class="form-control proj-period" placeholder="ММ.ГГГГ - ММ.ГГГГ" value="${escHtml(data?.period||'')}">
        <span style="font-size:0.7rem;color:var(--text-muted);">Пример: 01.2024 - 06.2024</span></div>
      <div class="form-group"><label class="form-label">Должность в рамках проекта</label>
        <input type="text" class="form-control proj-position" placeholder="Консультант по внедрению 1С" value="${escHtml(data?.position||'')}"></div>
      <div class="form-group"><label class="form-label">Роль в рамках проекта</label>
        <input type="text" class="form-control proj-role" placeholder="Разработчик / Архитектор / Аналитик" value="${escHtml(data?.role||'')}"></div>
      <div class="form-group"><label class="form-label">Размер команды</label>
        <input type="text" class="form-control proj-team" placeholder="5 человек" value="${escHtml(data?.team_size||'')}"></div>
      <div class="form-group"><label class="form-label">Заказчик + отрасль</label>
        <input type="text" class="form-control proj-client" placeholder="ООО «Пример» (нефтегазовая отрасль)" value="${escHtml(data?.client||'')}"></div>
      <div class="form-group"><label class="form-label">Описание проекта</label>
        <textarea class="form-control proj-descr" rows="2" placeholder="Краткое описание проекта">${escHtml(data?.project_description||'')}</textarea></div>
      <div class="form-group"><label class="form-label">Описание задачи, реализованной сотрудником</label>
        <textarea class="form-control proj-task" rows="2" placeholder="Что было сделано?">${escHtml(data?.task_description||'')}</textarea></div>
      <div class="form-group"><label class="form-label">Программные продукты / Технологии</label>
        <input type="text" class="form-control proj-tech" placeholder="1С:ERP 2.5, XML, JSON, REST API" value="${escHtml(data?.technologies||'')}"></div>
    </div>`;
  c.appendChild(e);
  
  // === НОВЫЙ КОД: маска для периода ===
  const periodInput = e.querySelector('.proj-period');
  if (periodInput) {
    maskPeriod(periodInput);
  }
  
  e.querySelectorAll('input, textarea').forEach(inp => inp.addEventListener('input', () => { 
    updateAccordionTitle(e, '.proj-summary'); 
    trackChanges(); 
  }));
}
function loadProjectData(arr) {
  document.getElementById('projectExperienceContainer').innerHTML = '';
  if (Array.isArray(arr) && arr.length > 0) arr.forEach(d => addProjectEntry(d));
  else if (typeof arr === 'string' && arr.trim()) addProjectEntry({ period: '', position: '', role: '', team_size: '', client: '', project_description: arr.trim(), task_description: '', technologies: '' });
  else addProjectEntry({ period: '', position: '', role: '', team_size: '', client: '', project_description: '', task_description: '', technologies: '' });
}

function getProjectData() {
  return Array.from(document.querySelectorAll('.proj-entry')).map(el => ({
    period: el.querySelector('.proj-period').value.trim(),
    position: el.querySelector('.proj-position').value.trim(),
    role: el.querySelector('.proj-role').value.trim(),
    team_size: el.querySelector('.proj-team').value.trim(),
    client: el.querySelector('.proj-client').value.trim(),
    project_description: el.querySelector('.proj-descr').value.trim(),
    task_description: el.querySelector('.proj-task').value.trim(),
    technologies: el.querySelector('.proj-tech').value.trim(),
  })).filter(p => p.period || p.position || p.role || p.client || p.project_description);
}

// ─── Load Employee ─────────────────────────────────────────────────────────
async function loadEmployee() {
  token = new URLSearchParams(location.search).get('token');
  if (!token) { showError(); return; }
  isViewMode = new URLSearchParams(location.search).get('mode') === 'view';
  try {
    const r = await fetch(`/api/form/${token}`);
    if (!r.ok) { showError(); return; }
    employee = await r.json();
    const [posR, compR] = await Promise.all([
      fetch('/api/form/positions'),
      fetch('/api/form/position-competencies'),
    ]);
    if (posR.ok) { const d = await posR.json(); populatePositions(d.positions); }
    if (compR.ok) { positionCompetencies = await compR.json(); }
    showForm(employee);
  } catch { showError(); }
}

function populatePositions(positions) {
  const sel = document.getElementById('f_position');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Выберите должность —</option>';
  (Array.isArray(positions) ? positions : []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p; sel.appendChild(opt);
  });
}

let positionCompetencies = {};

async function loadPositionCompetencies() {
  try {
    const r = await fetch('/api/form/position-competencies');
    if (r.ok) positionCompetencies = await r.json();
  } catch {}
}

function showError() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.remove('hidden');
  if (managerUser) {
    const bd = document.getElementById('backToDashError');
    if (bd) bd.style.display = 'block';
  }
}

function showForm(emp) {
  originalValues = {};
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('formState').classList.remove('hidden');

  document.getElementById('employeeName').textContent = emp.name;
  document.getElementById('employeePos').textContent = emp.position || '';
  document.getElementById('avatarEl').textContent = initials(emp.name);

  if (emp.hasPending) document.getElementById('pendingWarning').classList.remove('hidden');

  loadEducationData(emp.education);
  originalValues._educationParsed = getEducationData();

  const posField = document.getElementById('f_position');
  if (posField) {
    if (emp.position) posField.value = emp.position;
    originalValues.position = emp.position || '';
    posField.onchange = () => {
      trackChanges();
      buildCompetencyChecklist(posField.value);
      syncChecklist(document.getElementById('f_competencies')?.value || '');
    };
  }

  const cityEl = document.getElementById('f_city');
  const emailEl = document.getElementById('f_email');
  if (cityEl) { cityEl.value = emp.city || ''; originalValues.city = cityEl.value; cityEl.oninput = trackChanges; }
  if (emailEl) { emailEl.value = emp.email || ''; originalValues.email = emailEl.value; emailEl.oninput = trackChanges; }

  loadJobData(emp.experience || { total: '', jobs: [] });
  originalValues._experienceParsed = getJobData();
  originalValues.total_experience = document.getElementById('f_total_experience')?.value || '';
  const totalEl = document.getElementById('f_total_experience');
  if (totalEl) totalEl.oninput = trackChanges;

  const aboutEl = document.getElementById('f_about');
  if (aboutEl) {
    aboutEl.value = emp.about || '';
    originalValues.about = emp.about || '';
    aboutEl.oninput = () => { autoResize(aboutEl); trackChanges(); };
  }

  const compEl = document.getElementById('f_competencies');
  if (compEl) {
    compEl.value = emp.competencies || '';
    originalValues.competencies = emp.competencies || '';
    compEl.oninput = trackChanges;
    syncChecklist(emp.competencies);
  }

  loadProjectData(emp.project_experience);
  originalValues._projectParsed = getProjectData();

  const certText = emp.certification || '';
  const certParts = certText.split(/\n\s*\n/);
  const certEl = document.getElementById('f_certification');
  const courseNameEl = document.getElementById('f_course_name');
  const courseYearEl = document.getElementById('f_course_year');
  if (certEl) {
    certEl.value = emp.certification_1c || (certParts.length > 0 ? certParts[0].replace(/^Сертификация 1С:?\s*/i, '').trim() : '') || '';
    originalValues.certification = certEl.value;
    certEl.oninput = trackChanges;
  }
  if (courseNameEl) {
    // Try to split courses by " — " to get name and year
    const coursesText = emp.courses || (certParts.length > 1 ? certParts[1] : '') || '';
    const parts = coursesText.split(' — ');
    courseNameEl.value = parts[0]?.trim() || '';
    originalValues.course_name = courseNameEl.value;
    courseNameEl.oninput = trackChanges;
  }
  if (courseYearEl) {
    const coursesText = emp.courses || (certParts.length > 1 ? certParts[1] : '') || '';
    const parts = coursesText.split(' — ');
    courseYearEl.value = parts[1]?.trim() || '';
    originalValues.course_year = courseYearEl.value;
    courseYearEl.oninput = trackChanges;
  }

  const dateEl = document.getElementById('lastUpdatedDate');
  if (dateEl && emp.updated_at) {
    const d = new Date(emp.updated_at);
    dateEl.textContent = '📅 Дата актуализации: ' + d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  trackChanges();
  renderViewContent();
  loadEmployeePhoto(employee);
  if (isViewMode) setViewMode(true);
}

function renderViewContent() {
  document.getElementById('viewPosition').innerHTML = viewValue(document.getElementById('f_position')?.value);
  document.getElementById('viewContacts').innerHTML =
    viewField('Город', document.getElementById('f_city')?.value) +
    viewField('Email', document.getElementById('f_email')?.value);
  document.getElementById('viewTotalExperience').innerHTML = viewValue(document.getElementById('f_total_experience')?.value);
  document.getElementById('viewAbout').innerHTML = viewValue(document.getElementById('f_about')?.value);
  document.getElementById('viewCompetencies').innerHTML = viewValue(document.getElementById('f_competencies')?.value);
  document.getElementById('viewCertification').innerHTML =
    viewField('Сертификаты 1С', document.getElementById('f_certification')?.value) +
    viewField('Наименование курса', document.getElementById('f_course_name')?.value) +
    viewField('Год прохождения', document.getElementById('f_course_year')?.value);
  document.getElementById('viewEducation').innerHTML = renderAccordionView(getEducationData(),
    d => d.institution || 'Образование',
    d => viewField('Квалификация', d.degree) + viewField('Направление', d.specialty) + viewField('Год окончания', d.year),
    'Образование не указано');
  document.getElementById('viewJobs').innerHTML = renderAccordionView(getJobData().jobs,
    d => d.company || d.position || 'Место работы',
    d => viewField('Должность', d.position) + viewField('Период', d.period),
    'История мест работы не указана');
  document.getElementById('viewProjects').innerHTML = renderAccordionView(getProjectData(),
    projectTitle,
    d => viewField('Период', d.period) + viewField('Должность', d.position) + viewField('Роль', d.role) +
      viewField('Размер команды', d.team_size) + viewField('Заказчик + отрасль', d.client) +
      viewField('Описание проекта', d.project_description) + viewField('Описание задачи', d.task_description) +
      viewField('Технологии', d.technologies),
    'Проектный опыт не указан');
}

function setViewMode(view) {
  isViewMode = view;
  const formState = document.getElementById('formState');
  document.getElementById('editModeBtn')?.classList.toggle('hidden', !view);
  document.getElementById('headerSubtitle').textContent = view ? '— Просмотр профиля' : '— Обновление профиля';
  formState.classList.toggle('view-mode', view);
  if (view) {
    document.getElementById('changedFieldsBadge')?.classList.add('hidden');
    document.getElementById('changesSummary').style.display = 'none';
    document.getElementById('pendingWarning')?.classList.add('hidden');
    renderViewContent();
  } else if (employee?.hasPending) {
    document.getElementById('pendingWarning')?.classList.remove('hidden');
    trackChanges();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 100) + 'px';
}

// ─── Track Changes ────────────────────────────────────────────────────────
function trackChanges() {
  const changedFields = [];
  const checks = {
    about: 'f_about', city: 'f_city', email: 'f_email',
    total_experience: 'f_total_experience', competencies: 'f_competencies',
    certification: 'f_certification', course_name: 'f_course_name', course_year: 'f_course_year',
    photo: 'f_photo',
  };
  for (const [field, id] of Object.entries(checks)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.value.trim() !== (originalValues[field] || '').trim()) {
      el.classList.add('changed'); changedFields.push(FIELD_NAMES[field] || field);
    } else el.classList.remove('changed');
  }
  const posEl = document.getElementById('f_position');
  if (posEl && posEl.value !== (originalValues.position || '')) {
    posEl.classList.add('changed'); changedFields.push(FIELD_NAMES.position);
  } else if (posEl) posEl.classList.remove('changed');

  if (JSON.stringify(getEducationData()) !== JSON.stringify(originalValues._educationParsed || [])) changedFields.push(FIELD_NAMES.education);
  if (JSON.stringify(getJobData()) !== JSON.stringify(originalValues._experienceParsed || {})) changedFields.push(FIELD_NAMES.experience);
  if (JSON.stringify(getProjectData()) !== JSON.stringify(originalValues._projectParsed || [])) changedFields.push(FIELD_NAMES.project_experience);

  const badge = document.getElementById('changedFieldsBadge');
  const summary = document.getElementById('changesSummary');
  const list = document.getElementById('changedFieldsList');
  const hint = document.getElementById('noChangesHint');

  if (changedFields.length > 0) {
    badge.textContent = changedFields.length + ' изм.'; badge.classList.remove('hidden');
    summary.style.display = 'block'; list.textContent = changedFields.join(', '); hint?.classList.add('hidden');
  } else {
    badge.classList.add('hidden'); summary.style.display = 'none'; hint?.classList.remove('hidden');
  }
}

// ─── Reset ─────────────────────────────────────────────────────────────────
document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('Сбросить все изменения к исходным данным?')) return;
  showForm(employee);
});

// ─── Submit ────────────────────────────────────────────────────────────────
function getChangedFieldNames() {
  const changedFields = [];
  const checks = {
    about: 'f_about', city: 'f_city', email: 'f_email',
    total_experience: 'f_total_experience', competencies: 'f_competencies',
    certification: 'f_certification', course_name: 'f_course_name', course_year: 'f_course_year',
    photo: 'f_photo',
  };
  for (const [field, id] of Object.entries(checks)) {
    const el = document.getElementById(id);
    if (el && el.value.trim() !== (originalValues[field] || '').trim()) changedFields.push(FIELD_NAMES[field] || field);
  }
  const posEl = document.getElementById('f_position');
  if (posEl && posEl.value !== (originalValues.position || '')) changedFields.push(FIELD_NAMES.position);
  if (JSON.stringify(getEducationData()) !== JSON.stringify(originalValues._educationParsed || [])) changedFields.push(FIELD_NAMES.education);
  if (JSON.stringify(getJobData()) !== JSON.stringify(originalValues._experienceParsed || {})) changedFields.push(FIELD_NAMES.experience);
  if (JSON.stringify(getProjectData()) !== JSON.stringify(originalValues._projectParsed || [])) changedFields.push(FIELD_NAMES.project_experience);
  return changedFields;
}

function collectFormFields() {
  return {
    position: document.getElementById('f_position').value,
    city: document.getElementById('f_city')?.value.trim() || '',
    email: document.getElementById('f_email')?.value.trim() || '',
    about: document.getElementById('f_about')?.value.trim() || '',
    competencies: document.getElementById('f_competencies')?.value.trim() || '',
    certification: document.getElementById('f_certification')?.value.trim() || '',
    course_name: document.getElementById('f_course_name')?.value.trim() || '',
    course_year: document.getElementById('f_course_year')?.value.trim() || '',
    photo: document.getElementById('f_photo')?.value.trim() || '',
    education: getEducationData(),
    experience: getJobData(),
    project_experience: getProjectData(),
  };
}

async function performSubmit(fields) {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Отправка...';

  const asManager = new URLSearchParams(location.search).get('as') === 'manager';

  // Если менеджер открыл форму через дашборд (?as=manager) — применяем напрямую
  if (asManager && managerUser && (managerUser.role === 'admin' || managerUser.role === 'scrum')) {
    try {
      const empId = employee.id;
      const payload = {};
      if (fields.position !== undefined) payload.position = fields.position;
      if (fields.about !== undefined) payload.about = fields.about;
      if (fields.competencies !== undefined) payload.competencies = fields.competencies;
      if (fields.certification !== undefined) {
        const certParts = [fields.certification, fields.courses ? 'Обучающие курсы: ' + fields.courses : ''].filter(Boolean);
        payload.certification = certParts.length ? 'Сертификация 1С:\n' + certParts.join('\n\n') : '';
      }
      if (fields.education !== undefined) payload.education = fields.education;
      if (fields.experience !== undefined) payload.experience = fields.experience;
      if (fields.project_experience !== undefined) payload.project_experience = fields.project_experience;
      if (fields.city !== undefined || fields.email !== undefined) {
        payload.contacts = [fields.city, fields.email].filter(Boolean).join('\n');
      }
      if (fields.city !== undefined) payload.city = fields.city;
      if (fields.email !== undefined) payload.email = fields.email;
      if (fields.photo !== undefined && fields.photo !== originalValues.photo) payload.photo = fields.photo;

      const r = await fetch(`/api/employees/${empId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (r.ok) {
        document.getElementById('formState').classList.add('hidden');
        document.getElementById('successState').classList.remove('hidden');
        document.querySelector('#successState h2').textContent = 'Данные сохранены!';
        document.querySelector('#successState p').textContent = 'Изменения применены напрямую без отправки на проверку.';
        document.getElementById('changesCountMsg').textContent = '';
        const bd = document.getElementById('backToDashManager');
        if (bd) bd.style.display = 'block';
      } else {
        toast(d.error || 'Ошибка при сохранении', 'error');
        btn.disabled = false;
        btn.innerHTML = 'Сохранить';
      }
    } catch {
      toast('Ошибка соединения с сервером', 'error');
      btn.disabled = false;
      btn.innerHTML = 'Сохранить';
    }
    return;
  }

  // Обычный сотрудник — отправка на проверку
  fields.contacts = [fields.city, fields.email].filter(Boolean).join('\n');
  fields.courses = [fields.course_name, fields.course_year].filter(Boolean).join(' — ');
  try {
    const r = await fetch(`/api/form/${token}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    if (r.ok) {
      const feedback = document.getElementById('f_feedback')?.value.trim();
      if (selectedRating || feedback) {
        await fetch(`/api/form/${token}/feedback`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: selectedRating || null, comment: feedback || '' }),
        }).catch(() => {});
      }
      document.getElementById('formState').classList.add('hidden');
      document.getElementById('successState').classList.remove('hidden');
      document.getElementById('changesCountMsg').textContent =
        d.changed > 0 ? `Изменено полей: ${d.changed}` : '';
    } else {
      toast(d.error || 'Ошибка при отправке', 'error');
      btn.disabled = false;
      btn.innerHTML = '✉️ Отправить на проверку';
    }
  } catch {
    toast('Ошибка соединения с сервером', 'error');
    btn.disabled = false;
    btn.innerHTML = '✉️ Отправить на проверку';
  }
}

document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (isViewMode) return;
  const changed = getChangedFieldNames();
  if (!changed.length) { toast('Изменений не обнаружено', 'warning'); return; }
  pendingSubmitFields = collectFormFields();
  document.getElementById('confirmChangesList').innerHTML =
    '<ul style="margin:0;padding-left:18px;">' + changed.map(f => `<li>${escHtml(f)}</li>`).join('') + '</ul>';
  const note = document.getElementById('confirmFeedbackNote');
  const fb = document.getElementById('f_feedback')?.value.trim();
  if (selectedRating || fb) {
    note.style.display = 'block';
    note.textContent = selectedRating ? `Обратная связь: ${selectedRating} ★${fb ? ' — ' + fb : ''}` : `Комментарий: ${fb}`;
  } else note.style.display = 'none';
  document.getElementById('confirmSubmitModal').classList.add('active');
});

document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
  document.getElementById('confirmSubmitModal').classList.remove('active');
  if (pendingSubmitFields) await performSubmit(pendingSubmitFields);
  pendingSubmitFields = null;
});
['closeConfirmModal', 'cancelConfirmBtn'].forEach(id => {
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('confirmSubmitModal').classList.remove('active');
    pendingSubmitFields = null;
  });
});
document.getElementById('confirmSubmitModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('confirmSubmitModal').classList.remove('active');
    pendingSubmitFields = null;
  }
});

document.getElementById('editModeBtn').addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.delete('mode');
  history.replaceState({}, '', url);
  setViewMode(false);
});

document.querySelectorAll('#starRating button').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedRating = Number(btn.dataset.star);
    document.querySelectorAll('#starRating button').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.star) <= selectedRating);
    });
  });
});

// ─── Event listeners ──────────────────────────────────────────────────────
document.getElementById('addEducationBtn').addEventListener('click', () => {
  addEducationEntry({ institution: '', degree: '', specialty: '', year: '' }); trackChanges();
});
document.getElementById('addJobBtn').addEventListener('click', () => {
  addJobEntry({ company: '', position: '', period: '' }); trackChanges();
});
document.getElementById('addProjectBtn').addEventListener('click', () => {
  addProjectEntry({ period: '', position: '', role: '', team_size: '', client: '', project_description: '', task_description: '', technologies: '' }); trackChanges();
});

function escHtml(str) {
  return String(str).replace(/&/g, '&').replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>');
}
// ─── Маска для периода: ММ.ГГГГ - ММ.ГГГГ ────────────────────────────────────
function maskPeriod(el) {
  if (!el) return;
  
  el.addEventListener('input', function(e) {
    let digits = this.value.replace(/\D/g, '');
    if (digits.length > 12) {
      digits = digits.slice(0, 12);
    }
    let result = '';
    for (let i = 0; i < digits.length; i++) {
      if (i === 2 || i === 8) {
        result += '.';
      } else if (i === 6) {
        result += ' - ';
      }
      result += digits[i];
    }
    this.value = result;
  });
  
  el.addEventListener('paste', function(e) {
    setTimeout(() => {
      const digits = this.value.replace(/\D/g, '');
      let result = '';
      for (let i = 0; i < digits.length && i < 12; i++) {
        if (i === 2 || i === 8) {
          result += '.';
        } else if (i === 6) {
          result += ' - ';
        }
        result += digits[i];
      }
      this.value = result;
    }, 10);
  });
}
let cropper = null;

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Выберите изображение', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast('Файл слишком большой (макс. 5 МБ)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const cropImg = document.getElementById('cropImage');
    cropImg.src = e.target.result;
    document.getElementById('photoCropModal').classList.add('active');
    if (cropper) cropper.destroy();
    cropper = new Cropper(cropImg, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      cropBoxMovable: true,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      minCropBoxWidth: 100,
      minCropBoxHeight: 100,
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

document.getElementById('applyCropBtn').addEventListener('click', () => {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const preview = document.getElementById('photoPreview');
  preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  document.getElementById('f_photo').value = dataUrl;
  document.getElementById('photoCropModal').classList.remove('active');
  cropper.destroy();
  cropper = null;
  trackChanges();
});

function closeCropModal() {
  document.getElementById('photoCropModal').classList.remove('active');
  if (cropper) { cropper.destroy(); cropper = null; }
}
document.getElementById('closeCropModal').addEventListener('click', closeCropModal);
document.getElementById('cancelCropBtn').addEventListener('click', closeCropModal);
document.getElementById('photoCropModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCropModal();
});

function loadEmployeePhoto(emp) {
  const photoEl = document.getElementById('f_photo');
  const preview = document.getElementById('photoPreview');
  
  // Check new photo fields first (file-based storage)
  const hasPhoto = emp.photo_path && emp.photo_filename;
  const isApproved = emp.photo_approved === 1 || emp.photo_approved === true;
  
  if (hasPhoto) {
    const previewUrl = `/api/employees/${emp.id}/photo/preview`;
    photoEl.value = previewUrl; // Store preview URL for reference
    let statusIcon = isApproved ? ' ✅' : ' ⏳';
    let statusText = isApproved ? ' (Одобрено)' : ' (На проверке)';
    preview.innerHTML = `<img src="${previewUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" title="Фото${statusText}">`;
  } else if (emp.photo) {
    // Legacy base64 photo support
    photoEl.value = emp.photo;
    preview.innerHTML = `<img src="${emp.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  }
  originalValues.photo = emp.photo || '';
  if (photoEl) photoEl.oninput = trackChanges;
}

// ─── Speller (Yandex) ──────────────────────────────────────────────────────
document.getElementById('spellerBtn').addEventListener('click', async () => {
  const btn = document.getElementById('spellerBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;margin:0;"></span> Исправление...';
  try {
    const fields = collectFormFields();
    const r = await fetch('/api/form/correct-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Ошибка'); }
    const data = await r.json();
    if (!data.ok) throw new Error('Ошибка ответа');
    const c = data.corrected;
    for (const [key, val] of Object.entries(c)) {
      const el = document.getElementById('f_' + key);
      if (el && val !== undefined) {
        el.value = val;
        el.dispatchEvent(new Event('input'));
      }
    }
    trackChanges();
    toast('Текст исправлен', 'success');
  } catch (e) {
    toast('Ошибка исправления: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '✨ Исправить текст';
});

// ─── Init ──────────────────────────────────────────────────────────────────
async function initForm() {
  initTheme();
  await loadPositionCompetencies();
  buildCompetencyChecklist();
  setupTemplateTriggers();

  // Check if user is a logged-in manager
  try {
    const auth = await fetch('/api/auth/me').then(r => r.json());
    if (auth.authenticated && auth.manager) {
      managerUser = auth.manager;
    }
  } catch {}

  await loadEmployee();

  // If manager opened via dashboard, update submit button text
  const asManager = new URLSearchParams(location.search).get('as') === 'manager';
  if (asManager && managerUser && (managerUser.role === 'admin' || managerUser.role === 'scrum')) {
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.innerHTML = 'Сохранить';
    // Hide feedback section for managers
    const fb = document.getElementById('feedbackSection');
    if (fb) fb.style.display = 'none';
    // Hide "pending" warning — managers don't create pending changes
    const pw = document.getElementById('pendingWarning');
    if (pw) pw.style.display = 'none';
    // Show back-to-dashboard link
    const bd = document.getElementById('backToDashManager');
    if (bd) bd.style.display = 'block';
  }
}
initForm();
