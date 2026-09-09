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

let employees = [];

function visibleEmployees() {
  const query = document.getElementById('archiveSearch').value.trim().toLowerCase();
  if (!query) return employees;
  return employees.filter(employee => [employee.name, employee.position, employee.city, employee.email]
    .some(value => String(value || '').toLowerCase().includes(query)));
}

function employeeProfileLink(link) {
  const url = new URL(link, window.location.origin);
  url.searchParams.set('as', 'manager');
  url.searchParams.set('mode', 'view');
  return url.toString();
}

function render() {
  document.getElementById('employeeArchiveCount').textContent = employees.length;
  const items = visibleEmployees();
  const grid = document.getElementById('archiveGrid');
  document.getElementById('restoreAllVisible').disabled = items.length === 0;

  if (!items.length) {
    grid.innerHTML = `<div class="archive-empty"><i class="fi fi-rr-box-open"></i>${document.getElementById('archiveSearch').value ? 'По вашему запросу ничего не найдено' : 'В архиве нет сотрудников'}</div>`;
    return;
  }

  grid.innerHTML = items.map(employee => `
    <article class="card archive-item">
      <div class="archive-item-head">
        <a class="archive-item-title" href="${escHtml(employeeProfileLink(employee.link))}">${escHtml(employee.name)}</a>
        ${employee.is_rp ? '<span class="badge badge-accent">РП</span>' : ''}
      </div>
      <div class="archive-item-meta">
        <span><i class="fi fi-rr-briefcase"></i>${escHtml(employee.position || 'Должность не указана')}</span>
        <span><i class="fi fi-rr-marker"></i>${escHtml(employee.city || 'Город не указан')}</span>
        <span><i class="fi fi-rr-calendar"></i>В архиве с ${escHtml(formatDate(employee.updated_at))}</span>
      </div>
      <div class="archive-item-actions">
        <button class="btn btn-primary btn-sm" type="button" onclick="restoreEmployee(${employee.id})"><i class="fi fi-rr-refresh"></i> Восстановить</button>
      </div>
    </article>`).join('');
}

async function loadArchive() {
  const response = await fetch('/api/employees');
  if (response.status === 401) return location.href = '/login.html';
  if (!response.ok) throw new Error('Не удалось загрузить архив сотрудников');
  employees = (await response.json()).filter(employee => employee.status === 'archived');
  render();
}

async function restoreEmployee(id, quiet = false) {
  const response = await fetch(`/api/employees/${id}/restore`, { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось восстановить сотрудника');
  employees = employees.filter(employee => Number(employee.id) !== Number(id));
  if (!quiet) toast('Сотрудник восстановлен', 'success');
  render();
}

document.getElementById('archiveSearch').addEventListener('input', render);
document.getElementById('restoreAllVisible').addEventListener('click', async () => {
  const items = visibleEmployees();
  if (!items.length || !confirm(`Восстановить всех найденных сотрудников (${items.length})?`)) return;
  const button = document.getElementById('restoreAllVisible');
  button.disabled = true;
  try {
    for (const employee of items) await restoreEmployee(employee.id, true);
    toast(`Восстановлено сотрудников: ${items.length}`, 'success');
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
