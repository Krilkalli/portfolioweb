function escHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function formatDate(value) {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU');
}

let projects = [];

function visibleProjects() {
  const query = document.getElementById('archiveSearch').value.trim().toLowerCase();
  if (!query) return projects;
  return projects.filter(project => [project.title, project.leader_name, project.leader_employee_name, project.customer]
    .some(value => String(value || '').toLowerCase().includes(query)));
}

function render() {
  document.getElementById('projectArchiveCount').textContent = projects.length;
  const items = visibleProjects();
  const grid = document.getElementById('archiveGrid');
  document.getElementById('restoreAllVisible').disabled = items.length === 0;

  if (!items.length) {
    grid.innerHTML = `<div class="archive-empty"><i class="fi fi-rr-box-open"></i>${document.getElementById('archiveSearch').value ? 'По вашему запросу ничего не найдено' : 'В архиве нет проектов'}</div>`;
    return;
  }

  grid.innerHTML = items.map(project => `
    <article class="card archive-item">
      <div class="archive-item-head">
        <a class="archive-item-title" href="/project.html?id=${project.id}">${escHtml(project.title)}</a>
        <span class="badge badge-muted">Архив</span>
      </div>
      <div class="archive-item-meta">
        <span><i class="fi fi-rr-user"></i>${escHtml(project.leader_name || project.leader_employee_name || 'РП не назначен')}</span>
        <span><i class="fi fi-rr-building"></i>${escHtml(project.customer || 'Заказчик не указан')}</span>
        <span><i class="fi fi-rr-calendar"></i>В архиве с ${escHtml(formatDate(project.updated_at))}</span>
      </div>
      <div class="archive-item-actions">
        <button class="btn btn-primary btn-sm" type="button" onclick="restoreProject(${project.id})"><i class="fi fi-rr-refresh"></i> Восстановить</button>
      </div>
    </article>`).join('');
}

async function loadArchive() {
  const response = await fetch('/api/projects');
  if (response.status === 401) return location.href = '/login.html';
  if (!response.ok) throw new Error('Не удалось загрузить архив проектов');
  const data = await response.json();
  projects = (data.projects || []).filter(project => project.status === 'Архив');
  render();
}

async function restoreProject(id, quiet = false) {
  const response = await fetch('/api/projects/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось восстановить проект');
  projects = projects.filter(project => Number(project.id) !== Number(id));
  if (!quiet) toast('Проект восстановлен', 'success');
  render();
}

document.getElementById('archiveSearch').addEventListener('input', render);
document.getElementById('restoreAllVisible').addEventListener('click', async () => {
  const items = visibleProjects();
  if (!items.length || !confirm(`Восстановить все найденные проекты (${items.length})?`)) return;
  const button = document.getElementById('restoreAllVisible');
  button.disabled = true;
  try {
    const response = await fetch('/api/projects/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: items.map(project => project.id) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось восстановить проекты');
    const restoredIds = new Set(items.map(project => Number(project.id)));
    projects = projects.filter(project => !restoredIds.has(Number(project.id)));
    toast(`Восстановлено проектов: ${items.length}`, 'success');
    render();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.getElementById('themeToggle').innerHTML = isLight ? '<i class="fi fi-rr-sun"></i>' : '<i class="fi fi-rr-moon"></i>';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

(async () => {
  const auth = await fetch('/api/auth/me').then(response => response.json()).catch(() => ({ authenticated:false }));
  if (!auth.authenticated) return location.href = '/login.html';
  document.getElementById('navbarManager').textContent = auth.manager ? `${auth.manager.name} — ${auth.manager.email}` : '';
  if (localStorage.getItem('theme') === 'light') document.getElementById('themeToggle').innerHTML = '<i class="fi fi-rr-sun"></i>';
  try {
    await loadArchive();
  } catch (error) {
    document.getElementById('archiveGrid').innerHTML = `<div class="archive-empty"><i class="fi fi-rr-cross-circle"></i>${escHtml(error.message)}</div>`;
  }
})();
