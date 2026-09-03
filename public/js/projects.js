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
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
let projects = [];
let leaders = [];
let selectedIds = new Set();
let searchQuery = '';
let leaderFilter = '';
let sortOrder = 'newest';
let showArchived = false;
let isAdmin = false;

function openModal() { document.getElementById('projectModal').classList.add('active'); }
function closeModal() { document.getElementById('projectModal').classList.remove('active'); }

function populateLeaderSelect() {
  const sel = document.getElementById('projectLeader');
  const filterSel = document.getElementById('projectLeaderFilter');

  if (sel) {
    if (!leaders.length) {
      sel.innerHTML = '<option value="">Нет доступных руководителей</option>';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = '<option value="">Выберите руководителя</option>';
      leaders.forEach(manager => {
        const opt = document.createElement('option');
        opt.value = manager.id;
        opt.textContent = manager.name;
        sel.appendChild(opt);
      });
    }
  }

  if (filterSel) {
    const current = filterSel.value;
    filterSel.innerHTML = '<option value="">Все руководители</option>';
    leaders.forEach(manager => {
      const opt = document.createElement('option');
      opt.value = String(manager.id);
      opt.textContent = manager.name;
      filterSel.appendChild(opt);
    });
    filterSel.value = current;
  }
}

function syncSelectAll() {
  const selectAll = document.getElementById('selectAllProjects');
  const checks = [...document.querySelectorAll('.project-check')];
  const activeChecks = checks.filter(c => !c.disabled);
  if (!selectAll) return;
  if (activeChecks.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    updateProjectActions();
    return;
  }
  selectAll.checked = activeChecks.every(c => c.checked);
  selectAll.indeterminate = activeChecks.some(c => c.checked) && !activeChecks.every(c => c.checked);
  updateProjectActions();
}

function updateProjectActions() {
  if (!isAdmin) return;
  const selected = projects.filter(project => selectedIds.has(Number(project.id)));
  const onlyArchived = selected.length > 0 && selected.every(project => project.status === 'Архив');
  const onlyActive = selected.length > 0 && selected.every(project => project.status !== 'Архив');
  document.getElementById('archiveProjectsBtn').style.display = onlyActive ? '' : 'none';
  document.getElementById('restoreProjectsBtn').style.display = onlyArchived ? '' : 'none';
}

function updateSelectionFromDom() {
  selectedIds.clear();
  document.querySelectorAll('.project-check').forEach(cb => {
    if (cb.checked) selectedIds.add(Number(cb.dataset.id));
  });
  syncSelectAll();
}

function applyFilters(list) {
  let out = [...list];

  if (!showArchived) {
    out = out.filter(p => p.status !== 'Архив');
  }

  if (leaderFilter) {
    out = out.filter(p => String(p.leader_employee_id || '') === leaderFilter);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    out = out.filter(p => {
      const leader = p.leader_name || p.leader_employee_name || '';
      return String(p.title || '').toLowerCase().includes(q) || String(leader).toLowerCase().includes(q);
    });
  }

  out.sort((a, b) => {
    const da = new Date(a.created_at || 0).getTime();
    const db = new Date(b.created_at || 0).getTime();
    return sortOrder === 'oldest' ? da - db : db - da;
  });

  return out;
}

function renderProjects(list) {
  const tbody = document.getElementById('projectsTbody');
  const filtered = applyFilters(list);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted)">Пока нет закреплённых проектов</td></tr>';
    syncSelectAll();
    return;
  }

  tbody.innerHTML = filtered.map(project => {
    const leader = project.leader_name || project.leader_employee_name || '—';
    const status = project.status || 'Черновик';
    const sent = status === 'Отправлено';
    const archived = status === 'Архив';
    const statusStyle = archived
      ? 'background:rgba(148,163,184,0.15);color:#94a3b8;'
      : sent
        ? 'background:rgba(34,197,94,0.15);color:var(--success);'
        : 'background:rgba(245,158,11,0.15);color:var(--warning);';
    const check = project.date_check || {};
    const dateDetails = (check.members || []).map(member => `${member.employee_name}: ${member.period || 'дата не заполнена'}`).join('\n');
    const dateLabel = !check.total
      ? 'Нет сотрудников'
      : check.missing
        ? `Не заполнено: ${check.missing}`
        : check.individual
          ? `Индивидуальные: ${check.individual}`
          : 'Даты совпадают';
    const dateStyle = !check.total
      ? 'background:rgba(148,163,184,0.15);color:#94a3b8;'
      : check.missing
        ? 'background:rgba(239,68,68,0.14);color:var(--danger);'
        : check.individual
          ? 'background:rgba(59,130,246,0.14);color:#60a5fa;'
          : 'background:rgba(34,197,94,0.15);color:var(--success);';

    return `
      <tr class="project-row ${archived ? 'row-archived' : ''}">
        <td class="col-check" data-admin-only style="text-align:center;${isAdmin ? '' : 'display:none;'}">
          <input type="checkbox" class="project-check" data-id="${project.id}" ${selectedIds.has(Number(project.id)) ? 'checked' : ''}>
        </td>
        <td><div class="project-name"><a href="/project.html?id=${project.id}" target="_self">${escHtml(project.title)}</a></div></td>
        <td><span class="badge" style="${statusStyle}padding:6px 10px;border-radius:999px;">${escHtml(status)}</span></td>
        <td>${escHtml(leader)}</td>
        <td class="date-check-column" title="${escHtml(dateDetails)}"><span class="badge date-check-badge" style="${dateStyle}padding:6px 10px;border-radius:999px;">${escHtml(dateLabel)}</span></td>
      </tr>
    `;
  }).join('');

  syncSelectAll();
}

async function loadProjects() {
  const r = await fetch('/api/projects');
  if (r.status === 401) { location.href = '/login.html'; return; }
  if (r.status === 403) { location.href = '/index.html'; return; }
  const d = await r.json();
  projects = d.projects || [];
  renderProjects(projects);
}

async function loadLeaders() {
  const r = await fetch('/api/project-employees');
  if (!r.ok) return;
  const d = await r.json();
  leaders = (d.employees || []).filter(m => m.is_rp && m.status !== 'archived');
  populateLeaderSelect();
}

document.getElementById('createProjectBtn').addEventListener('click', () => {
  if (!leaders.length) {
    toast('Сначала назначьте РП на дашборде', 'warning');
    return;
  }
  document.getElementById('projectForm').reset();
  document.getElementById('projectFormResult').textContent = '';
  populateLeaderSelect();
  openModal();
});

document.getElementById('closeProjectModal').addEventListener('click', closeModal);
document.getElementById('cancelProjectBtn').addEventListener('click', closeModal);
document.getElementById('projectModal').addEventListener('click', (e) => { if (e.target.id === 'projectModal') closeModal(); });

document.getElementById('projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('saveProjectBtn');
  const result = document.getElementById('projectFormResult');
  const title = document.getElementById('projectTitle').value.trim();
  const leaderId = document.getElementById('projectLeader').value;

  if (!title) { result.style.color = 'var(--danger)'; result.textContent = 'Введите название проекта'; return; }
  if (!leaderId) { result.style.color = 'var(--danger)'; result.textContent = 'Выберите руководителя'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Сохранение...';

  try {
    const r = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, leaderEmployeeId: leaderId }),
    });
    const d = await r.json();
    if (r.ok) {
      toast('Проект создан', 'success');
      closeModal();
      await loadProjects();
    } else {
      result.style.color = 'var(--danger)';
      result.textContent = d.error || 'Ошибка создания';
    }
  } catch {
    result.style.color = 'var(--danger)';
    result.textContent = 'Ошибка соединения';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fi fi-rr-plus"></i> Создать';
  }
});

document.getElementById('uploadExcelBtn').addEventListener('click', () => document.getElementById('projectExcelInput').click());

document.getElementById('projectExcelInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/projects/import', { method: 'POST', body: fd });
    const d = await r.json();
    if (r.ok) {
      toast(`Обработано проектов: ${d.imported}`, 'success');
      const result = document.getElementById('projectImportResult');
      result.style.display = 'block';
      result.innerHTML = `
        <strong>Импорт опыта сотрудников завершён</strong>
        <div style="margin-top:6px;color:var(--text-muted);font-size:0.88rem;">
          Проекты: создано ${Number(d.projectsCreated || 0)}, обновлено ${Number(d.projectsUpdated || 0)}.<br>
          Сотрудники: создано ${Number(d.employeesCreated || 0)}, обновлено ${Number(d.employeesUpdated || 0)}.<br>
          Пропущено жёлтых строк: ${Number(d.skippedInactiveRows || 0)} (${Number(d.inactiveEmployees || 0)} неработающих сотрудников).
          Загруженные проекты созданы как черновики. Откройте карточки и назначьте РП — проект сразу появится в его кабинете.
        </div>`;
      await loadProjects();
    } else {
      toast(d.error || 'Ошибка импорта', 'error');
    }
  } catch {
    toast('Ошибка при загрузке файла', 'error');
  } finally {
    e.target.value = '';
  }
});

document.getElementById('archiveProjectsBtn').addEventListener('click', async () => {
  if (selectedIds.size === 0) { toast('Сначала выберите проекты', 'warning'); return; }
  if (!confirm(`Переместить в архив ${selectedIds.size} проектов?`)) return;
  try {
    const r = await fetch('/api/projects/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });
    const d = await r.json();
    if (r.ok) {
      toast(`В архив перемещено: ${d.archived}`, 'success');
      selectedIds.clear();
      await loadProjects();
    } else {
      toast(d.error || 'Ошибка архивации', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
});

document.getElementById('restoreProjectsBtn').addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  try {
    const r = await fetch('/api/projects/restore', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ids:[...selectedIds] }) });
    const d = await r.json();
    if (!r.ok) return toast(d.error || 'Ошибка восстановления', 'error');
    toast(`Восстановлено проектов: ${d.restored}`, 'success');
    selectedIds.clear(); await loadProjects();
  } catch { toast('Ошибка соединения', 'error'); }
});

document.getElementById('selectAllProjects').addEventListener('change', (e) => {
  const checks = [...document.querySelectorAll('.project-check')];
  checks.forEach(cb => {
    if (cb.disabled) return;
    cb.checked = e.target.checked;
    const id = Number(cb.dataset.id);
    if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
  });
  syncSelectAll();
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('project-check')) {
    const id = Number(e.target.dataset.id);
    if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
    syncSelectAll();
  }
});

document.getElementById('projectSearchInput').addEventListener('input', (e) => { searchQuery = e.target.value.trim(); renderProjects(projects); });
document.getElementById('projectLeaderFilter').addEventListener('change', (e) => { leaderFilter = e.target.value; renderProjects(projects); });
document.getElementById('projectSortOrder').addEventListener('change', (e) => { sortOrder = e.target.value; renderProjects(projects); });
document.getElementById('showArchivedProjects').addEventListener('change', (e) => { showArchived = e.target.checked; renderProjects(projects); });

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }
  if (!['admin', 'leader'].includes(auth.manager?.role)) { location.href = '/index.html'; return; }
  currentManager = auth.manager;
  isAdmin = currentManager.role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach(element => { element.style.display = isAdmin ? '' : 'none'; });
  if (!isAdmin) {
    document.getElementById('projectsSubtitle').textContent = 'Здесь отображаются только проекты, в которых вы назначены руководителем.';
  }
  document.getElementById('navbarManager').textContent = currentManager?.email || '';
  initTheme();
  await Promise.all([loadLeaders(), loadProjects()]);
})();
