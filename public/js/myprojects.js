function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '<i class="fi fi-rr-check-circle"></i>', error: '<i class="fi fi-rr-cross-circle"></i>', info: '<i class="fi fi-rr-info"></i>', warning: '<i class="fi fi-rr-triangle-warning"></i>' };
  t.innerHTML = `<span>${icons[type] || '<i class="fi fi-rr-info"></i>'}</span> `;
  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  t.appendChild(textSpan);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  if (saved === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('themeToggle').innerHTML = '<i class="fi fi-rr-sun"></i>';
  }
}

document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.getElementById('themeToggle').innerHTML = isLight ? '<i class="fi fi-rr-sun"></i>' : '<i class="fi fi-rr-moon"></i>';
});

let token = null;
let employee = null;
let projects = [];
let functionalBlockOptions = [];

const EDITABLE_FIELDS = ['title','customer','code_name','legal_customer_name','industry_description','description','start_period','end_period','team_size','technologies'];

function parseToken() {
  return new URLSearchParams(location.search).get('token');
}

function backUrl() {
  const mode = new URLSearchParams(location.search).get('mode');
  return `/form.html?token=${token}${mode ? '&mode=manager' : ''}`;
}

function renderProjects() {
  const list = document.getElementById('projectsList');
  if (!projects.length) {
    list.innerHTML = '<div class="project-card" style="color:var(--text-muted)">Пока нет проектов</div>';
    return;
  }

  list.innerHTML = projects.map(project => {
    const teamMembers = Array.isArray(project.team_members) ? project.team_members : [];
    const selectedBlocks = Array.isArray(project.functional_blocks) ? project.functional_blocks : [];
    const blockOptions = [...new Set([...functionalBlockOptions, ...selectedBlocks])].sort((a, b) => a.localeCompare(b, 'ru'));
    return `
      <div class="project-card" data-project-id="${project.id}">
        <div class="project-head">
          <div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="font-size:1.05rem;font-weight:700;">${escHtml(project.title)}</div>
            <span class="badge badge-accent">${escHtml(project.status || 'Отправлено')}</span>
          </div>
          <div class="muted" style="font-size:0.85rem;margin-top:4px;">${escHtml(project.customer || '')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" type="button" onclick="toggleEdit(${project.id})">Редактировать</button>
        </div>
      </div>

        <div class="team-box">
          <div class="project-view" data-view-id="${project.id}">
            <div class="view-field"><div class="view-field-label">Заказчик</div><div class="view-field-value">${escHtml(project.customer || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Кодовое название</div><div class="view-field-value">${escHtml(project.code_name || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Юридическое название заказчика</div><div class="view-field-value">${escHtml(project.legal_customer_name || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Вид деятельности компании</div><div class="view-field-value">${escHtml(project.industry_description || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Описание проекта</div><div class="view-field-value">${escHtml(project.description || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Период</div><div class="view-field-value">${escHtml([project.start_period, project.end_period].filter(Boolean).join(' - ') || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Размер команды</div><div class="view-field-value">${escHtml(String(project.team_size || 0))}</div></div>
            <div class="view-field"><div class="view-field-label">Технологии</div><div class="view-field-value">${escHtml(project.technologies || '—')}</div></div>
            <div class="view-field"><div class="view-field-label">Функциональные блоки</div><div class="view-field-value">${escHtml(selectedBlocks.join(', ') || '—')}</div></div>
            <details style="margin-top:12px;">
              <summary class="member-toggle">Команда проекта</summary>
              <div style="margin-top:12px;">
                ${(teamMembers.length ? teamMembers : []).map((m, idx) => `<div style="font-size:0.85rem;margin-bottom:6px;">${idx + 1}. ${escHtml(m.employee_name || '')}</div>`).join('') || '<div class="muted">Нет участников</div>'}
              </div>
            </details>
          </div>

          <div class="project-edit" data-edit-id="${project.id}" style="display:none;">
            <div class="form-group"><label class="form-label">Название проекта</label><input class="form-control" data-field="title" value="${escHtml(project.title || '')}"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Кодовое название проекта</label><input class="form-control" data-field="code_name" value="${escHtml(project.code_name || '')}"></div>
              <div class="form-group"><label class="form-label">Юридическое название заказчика</label><input class="form-control" data-field="legal_customer_name" value="${escHtml(project.legal_customer_name || '')}"></div>
            </div>
            <div class="form-group"><label class="form-label">Заказчик</label><input class="form-control" data-field="customer" value="${escHtml(project.customer || '')}"></div>
            <div class="form-group"><label class="form-label">Описание компании / вида деятельности</label><input class="form-control" data-field="industry_description" value="${escHtml(project.industry_description || '')}" placeholder="Например: крупная нефтяная компания"></div>
            <div class="form-group"><label class="form-label">Описание проекта</label><textarea class="form-control" data-field="description" rows="4">${escHtml(project.description || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Начало периода</label><input class="form-control" data-field="start_period" value="${escHtml(project.start_period || '')}" placeholder="ММ.ГГГГ"></div>
              <div class="form-group"><label class="form-label">Конец периода</label><input class="form-control" data-field="end_period" value="${escHtml(project.end_period || '')}" placeholder="ММ.ГГГГ"></div>
            </div>
            <div class="form-group"><label class="form-label">Размер команды</label><input class="form-control" data-field="team_size" type="number" min="0" value="${escHtml(project.team_size || 0)}"></div>
            <div class="form-group"><label class="form-label">Программные продукты / технологии</label><input class="form-control" data-field="technologies" value="${escHtml(project.technologies || '')}"></div>
            <div class="form-group">
              <label class="form-label">Функциональные блоки</label>
              <div class="checkbox-grid" data-blocks-id="${project.id}">
                ${blockOptions.map(block => `<label class="checkbox-option"><input type="checkbox" value="${escHtml(block)}" ${selectedBlocks.includes(block) ? 'checked' : ''}><span>${escHtml(block)}</span></label>`).join('') || '<div class="muted">Блоки ещё не добавлены</div>'}
              </div>
              <div style="display:flex;gap:8px;margin-top:10px;"><input class="form-control" data-new-block-id="${project.id}" placeholder="Добавить свой блок"><button type="button" class="btn btn-ghost btn-sm" onclick="addFunctionalBlock(${project.id})">Добавить</button></div>
            </div>
            <div class="team-box" style="margin-top:12px;">
              <div class="section-head" style="margin-bottom:10px;">
                <div class="card-title">Команда проекта</div>
                <button type="button" class="btn btn-ghost btn-sm" onclick="addMember(${project.id})">+ Добавить сотрудника</button>
              </div>
              <div data-members-id="${project.id}"></div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
              <button class="btn btn-ghost btn-sm" type="button" onclick="cancelEdit(${project.id})">Отмена</button>
              <button class="btn btn-primary btn-sm" type="button" onclick="saveProject(${project.id})">Сохранить</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  projects.forEach(p => renderMembers(p.id));
}

function renderMembers(id) {
  const wrap = document.querySelector(`[data-members-id="${id}"]`);
  if (!wrap) return;
  const project = projects.find(p => Number(p.id) === Number(id));
  const members = Array.isArray(project?.team_members) ? project.team_members : [];
  const size = Number(project?.team_size || 0);
  const rows = Math.max(size, members.length);
  if (!rows) {
    wrap.innerHTML = '<div class="muted">Сначала укажите размер команды</div>';
    return;
  }
  wrap.innerHTML = Array.from({ length: rows }).map((_, idx) => {
    const current = members[idx]?.employee_id || '';
    return `
      <div class="team-row">
        <select class="form-control" data-member-id="${id}" data-member-idx="${idx}">
          <option value="">Выберите сотрудника</option>
          ${(employeesCache || []).map(emp => `<option value="${emp.id}" ${String(current) === String(emp.id) ? 'selected' : ''}>${escHtml(emp.name)}</option>`).join('')}
        </select>
        <div style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${idx + 1}</div>
        <button type="button" class="btn btn-ghost btn-icon" onclick="removeMember(${id}, ${idx})" title="Удалить"><i class="fi fi-rr-trash"></i></button>
      </div>
    `;
  }).join('');
}

let employeesCache = [];

async function loadEmployees() {
  const r = await fetch(`/api/form/${token}/project-employees`);
  const d = await r.json();
  employeesCache = d.employees || [];
}

async function loadFunctionalBlocks() {
  const response = await fetch(`/api/form/${token}/project-functional-blocks`);
  const data = await response.json();
  functionalBlockOptions = data.blocks || [];
}

async function loadProjects() {
  const r = await fetch(`/api/form/${token}/projects`);
  const d = await r.json();
  projects = (d.projects || []).map(p => ({ ...p, team_members: Array.isArray(p.team_members) ? p.team_members : [] }));
  renderProjects();
}

function toggleEdit(id) {
  const view = document.querySelector(`[data-view-id="${id}"]`);
  const edit = document.querySelector(`[data-edit-id="${id}"]`);
  if (!view || !edit) return;
  const hidden = edit.style.display === 'none';
  edit.style.display = hidden ? 'block' : 'none';
  view.style.display = hidden ? 'none' : 'block';
  if (hidden) renderMembers(id);
}

function cancelEdit(id) {
  renderProjects();
}

function addMember(id) {
  const project = projects.find(p => Number(p.id) === Number(id));
  if (!project) return;
  project.team_members = project.team_members || [];
  project.team_members.push({ employee_id: '' });
  project.team_size = Math.max(Number(project.team_size || 0), project.team_members.length);
  renderProjects();
  toggleEdit(id);
}

function removeMember(id, idx) {
  const project = projects.find(p => Number(p.id) === Number(id));
  if (!project) return;
  project.team_members.splice(idx, 1);
  project.team_size = Math.max(0, project.team_members.length);
  renderProjects();
  toggleEdit(id);
}

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-member-id]')) {
    const id = Number(e.target.dataset.memberId);
    const idx = Number(e.target.dataset.memberIdx);
    const project = projects.find(p => Number(p.id) === id);
    if (!project) return;
    if (!project.team_members[idx]) project.team_members[idx] = { employee_id: '' };
    project.team_members[idx].employee_id = e.target.value;
    project.team_members[idx].employee_name = employeesCache.find(emp => String(emp.id) === String(e.target.value))?.name || '';
  }
  if (e.target.closest('[data-blocks-id]')) {
    const id = Number(e.target.closest('[data-blocks-id]').dataset.blocksId);
    const project = projects.find(item => Number(item.id) === id);
    if (!project) return;
    project.functional_blocks = [...document.querySelectorAll(`[data-blocks-id="${id}"] input:checked`)].map(input => input.value);
  }
});

function addFunctionalBlock(id) {
  const input = document.querySelector(`[data-new-block-id="${id}"]`);
  const value = input?.value.trim();
  const project = projects.find(item => Number(item.id) === Number(id));
  if (!value || !project) return;
  if (!functionalBlockOptions.includes(value)) functionalBlockOptions.push(value);
  project.functional_blocks = Array.isArray(project.functional_blocks) ? project.functional_blocks : [];
  if (!project.functional_blocks.includes(value)) project.functional_blocks.push(value);
  renderProjects();
  toggleEdit(id);
}

async function saveProject(id) {
  const edit = document.querySelector(`[data-edit-id="${id}"]`);
  const project = projects.find(p => Number(p.id) === Number(id));
  if (!edit || !project) return;
  const payload = {};
  EDITABLE_FIELDS.forEach(field => {
    const el = edit.querySelector(`[data-field="${field}"]`);
    if (!el) return;
    payload[field] = field === 'team_size' ? Number(el.value || 0) : el.value;
  });
  payload.team_members = project.team_members || [];
  payload.functional_blocks = project.functional_blocks || [];

  const r = await fetch(`/api/form/${token}/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (r.ok) {
    toast('Проект сохранён', 'success');
    await loadProjects();
  } else {
    toast(d.error || 'Ошибка сохранения', 'error');
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

document.getElementById('backBtn').addEventListener('click', (e) => {
  e.preventDefault();
  location.href = backUrl();
});

(async () => {
  token = parseToken();
  if (!token) { location.href = '/login.html'; return; }
  const employeeResponse = await fetch(`/api/form/${token}`);
  if (!employeeResponse.ok) { location.href = '/login.html'; return; }
  employee = await employeeResponse.json();
  if (!employee.is_rp) { location.href = backUrl(); return; }
  document.getElementById('navbarManager').textContent = employee.name || '';
  initTheme();
  document.getElementById('backBtn').href = backUrl();
  await loadEmployees();
  await loadFunctionalBlocks();
  await loadProjects();
})();
