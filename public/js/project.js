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
  setTimeout(() => { t.style.animation = 'none'; t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
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

let currentManager = null;
let projectId = null;
let employees = [];
let teamMembers = [];
let functionalBlockOptions = [];
let selectedFunctionalBlocks = [];

function projectMemberTitle(project) {
  return (project?.title || '').trim() || 'Новый проект';
}

function normalizeProjectExperienceEntry(project) {
  const period = [project?.start_period || '', project?.end_present ? 'настоящее время' : (project?.end_period || '')].filter(Boolean).join(' - ');
  return {
    period,
    project_name: projectMemberTitle(project),
    position: '',
    role: '',
    team_size: String(project?.team_size || ''),
    client: (project?.customer || '').trim(),
    project_description: project?.description || '',
    task_description: '',
    technologies: project?.technologies || '',
  };
}

async function syncProjectExperienceToMembers() {
  if (!projectId || !teamMembers.length) return;
  await Promise.all(teamMembers.map(async (member) => {
    const employeeId = Number(member.employee_id || 0);
    if (!employeeId) return;
    await fetch(`/api/projects/${projectId}/members/${employeeId}/sync-project-experience`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: normalizeProjectExperienceEntry({
        title: document.getElementById('title').value.trim(),
        customer: document.getElementById('customer').value.trim(),
        start_period: document.getElementById('start_period').value.trim(),
        end_period: document.getElementById('end_period').value.trim(),
        end_present: document.getElementById('end_present').checked,
        team_size: Number(document.getElementById('team_size').value || 0),
        description: document.getElementById('description').value.trim(),
        technologies: document.getElementById('technologies').value.trim(),
      }) }),
    });
  }));
}

function parseQuery() {
  const params = new URLSearchParams(location.search);
  return params.get('id');
}

function updateTitle() {
  document.getElementById('pageTitle').textContent = document.getElementById('title').value || 'Карточка проекта';
}

function renderLeaderOptions(selectedId = '') {
  const select = document.getElementById('leader_employee_id');
  const leaders = employees.filter(employee => employee.is_rp && employee.status !== 'archived');
  select.innerHTML = '<option value="">Не назначен</option>' + leaders.map(employee =>
    `<option value="${employee.id}" ${String(selectedId || '') === String(employee.id) ? 'selected' : ''}>${escHtml(employee.name)}</option>`
  ).join('');
}

function renderFunctionalBlocks() {
  const checklist = document.getElementById('functionalBlocksChecklist');
  const values = [...new Set([...functionalBlockOptions, ...selectedFunctionalBlocks])].sort((a, b) => a.localeCompare(b, 'ru'));
  if (!values.length) {
    checklist.innerHTML = '<div class="muted">Блоки ещё не добавлены</div>';
    return;
  }
  checklist.innerHTML = values.map(block => `
    <label class="checkbox-option">
      <input type="checkbox" value="${escHtml(block)}" ${selectedFunctionalBlocks.includes(block) ? 'checked' : ''}>
      <span>${escHtml(block)}</span>
    </label>
  `).join('');
}

function renderTeam() {
  const wrap = document.getElementById('teamMembers');
  const count = Math.max(0, Number(document.getElementById('team_size').value || 0));
  const items = teamMembers.slice(0, count || teamMembers.length);

  if (!items.length) {
    wrap.innerHTML = '<div class="muted" style="font-size:0.85rem;">Пока нет участников</div>';
    return;
  }

  wrap.innerHTML = items.map((member, idx) => `
    <div class="team-row">
      <select class="form-control team-member-select" data-idx="${idx}">
        <option value="">Выберите сотрудника</option>
        ${employees.map(emp => `<option value="${emp.id}" ${String(member.employee_id || '') === String(emp.id) ? 'selected' : ''}>${escHtml(emp.name)}</option>`).join('')}
      </select>
      <div style="font-size:0.8rem;color:var(--text-muted);white-space:nowrap;">${idx + 1}</div>
      <button type="button" class="btn btn-ghost btn-icon delete-member-btn" data-idx="${idx}" title="Удалить"><i class="fi fi-rr-trash"></i></button>
    </div>
  `).join('');
}

function syncMembersToTeamSize() {
  const size = Math.max(0, Number(document.getElementById('team_size').value || 0));
  while (teamMembers.length < size) teamMembers.push({ employee_id: '' });
  while (teamMembers.length > size) teamMembers.pop();
  renderTeam();
}

function setFormData(project) {
  document.getElementById('title').value = project.title || '';
  renderLeaderOptions(project.leader_employee_id || '');
  document.getElementById('code_name').value = project.code_name || '';
  document.getElementById('legal_customer_name').value = project.legal_customer_name || '';
  document.getElementById('customer').value = project.customer || '';
  document.getElementById('industry_description').value = project.industry_description || '';
  document.getElementById('description').value = project.description || '';
  document.getElementById('start_period').value = project.start_period || '';
  document.getElementById('end_period').value = project.end_period || '';
  document.getElementById('end_present').checked = !!project.end_present;
  document.getElementById('end_period').readOnly = !!project.end_present;
  document.getElementById('team_size').value = project.team_size || 0;
  document.getElementById('technologies').value = project.technologies || '';
  selectedFunctionalBlocks = Array.isArray(project.functional_blocks) ? [...project.functional_blocks] : [];
  renderFunctionalBlocks();
  teamMembers = Array.isArray(project.team_members) ? project.team_members.map(m => ({ ...m, employee_id: m.employee_id || '' })) : [];
  document.getElementById('teamWrapper').style.display = (project.team_size || teamMembers.length) ? 'block' : 'none';
  document.getElementById('toggleTeamBtn').textContent = (project.team_size || teamMembers.length) ? 'Свернуть' : 'Развернуть';
  syncMembersToTeamSize();
}

async function loadEmployees() {
  const r = await fetch('/api/employees');
  const d = await r.json();
  employees = (d || []).filter(e => e.status !== 'archived');
}

async function loadFunctionalBlocks() {
  const response = await fetch('/api/projects/functional-blocks');
  const data = await response.json();
  functionalBlockOptions = Array.isArray(data.blocks) ? data.blocks : [];
}

async function loadProject() {
  projectId = parseQuery();
  if (!projectId) { location.href = '/projects.html'; return; }
  const r = await fetch(`/api/projects/${projectId}`);
  if (r.status === 401) { location.href = '/login.html'; return; }
  if (r.status === 403) { location.href = '/index.html'; return; }
  if (!r.ok) { location.href = '/projects.html'; return; }
  const d = await r.json();
  setFormData(d.project);
}

async function saveProject() {
  const payload = {
    title: document.getElementById('title').value.trim(),
    leader_employee_id: document.getElementById('leader_employee_id').value || null,
    code_name: document.getElementById('code_name').value.trim(),
    legal_customer_name: document.getElementById('legal_customer_name').value.trim(),
    customer: document.getElementById('customer').value.trim(),
    industry_description: document.getElementById('industry_description').value.trim(),
    description: document.getElementById('description').value.trim(),
    start_period: document.getElementById('start_period').value.trim(),
    end_period: document.getElementById('end_period').value.trim(),
    end_present: document.getElementById('end_present').checked,
    team_size: Number(document.getElementById('team_size').value || 0),
    technologies: document.getElementById('technologies').value.trim(),
    functional_blocks: selectedFunctionalBlocks,
    team_members: teamMembers,
  };

  const r = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await r.json();
  if (r.ok) {
    toast('Проект сохранён', 'success');
    document.getElementById('result').innerHTML = '<span style="color:var(--success)">Сохранено</span>';
    setFormData(d.project);
    await syncProjectExperienceToMembers();
  } else {
    toast(d.error || 'Ошибка сохранения', 'error');
  }
}

document.getElementById('title').addEventListener('input', updateTitle);
document.getElementById('team_size').addEventListener('change', syncMembersToTeamSize);

document.getElementById('addTeamMemberBtn').addEventListener('click', () => {
  teamMembers.push({ employee_id: '' });
  document.getElementById('team_size').value = teamMembers.length;
  document.getElementById('teamWrapper').style.display = 'block';
  document.getElementById('toggleTeamBtn').textContent = 'Свернуть';
  renderTeam();
});

document.getElementById('teamMembers').addEventListener('change', (e) => {
  if (e.target.classList.contains('team-member-select')) {
    const idx = Number(e.target.dataset.idx);
    if (!teamMembers[idx]) teamMembers[idx] = { employee_id: '' };
    teamMembers[idx].employee_id = e.target.value;
    teamMembers[idx].employee_name = employees.find(employee => String(employee.id) === String(e.target.value))?.name || '';
    syncProjectExperienceToMembers().catch(() => {});
  }
});

document.getElementById('functionalBlocksChecklist').addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  selectedFunctionalBlocks = [...document.querySelectorAll('#functionalBlocksChecklist input:checked')].map(input => input.value);
});

document.getElementById('addFunctionalBlockBtn').addEventListener('click', () => {
  const input = document.getElementById('newFunctionalBlock');
  const value = input.value.trim();
  if (!value) return;
  if (!functionalBlockOptions.includes(value)) functionalBlockOptions.push(value);
  if (!selectedFunctionalBlocks.includes(value)) selectedFunctionalBlocks.push(value);
  input.value = '';
  renderFunctionalBlocks();
});

document.getElementById('teamMembers').addEventListener('click', (e) => {
  const btn = e.target.closest('.delete-member-btn');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  teamMembers.splice(idx, 1);
  document.getElementById('team_size').value = teamMembers.length;
  renderTeam();
  syncProjectExperienceToMembers().catch(() => {});
});

document.getElementById('saveProjectBtnTop').addEventListener('click', saveProject);
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

document.getElementById('toggleTeamBtn').addEventListener('click', () => {
  const wrap = document.getElementById('teamWrapper');
  const hidden = wrap.style.display === 'none';
  wrap.style.display = hidden ? 'block' : 'none';
  document.getElementById('toggleTeamBtn').textContent = hidden ? 'Свернуть' : 'Развернуть';
});

document.getElementById('end_present').addEventListener('change', (e) => {
  const endInput = document.getElementById('end_period');
  endInput.readOnly = e.target.checked;
  if (e.target.checked) endInput.value = '';
});

(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }
  if (auth.manager?.role !== 'admin') { location.href = '/index.html'; return; }
  currentManager = auth.manager;
  document.getElementById('navbarManager').textContent = currentManager?.email || '';
  initTheme();
  await loadEmployees();
  await loadFunctionalBlocks();
  await loadProject();
  renderTeam();
  updateTitle();
})();
