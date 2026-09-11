function escHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
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
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU');
}

function employeeProfileLink(employee) {
  const source = employee.manager_link || employee.link || '';
  try {
    const url = new URL(source, window.location.origin);
    url.searchParams.set('as', 'manager');
    url.searchParams.set('mode', 'view');
    return url.toString();
  } catch {
    return source;
  }
}

let employees = [];
let currentManager = null;
const selectedIds = new Set();

function isDepartmentAdmin() {
  return currentManager?.role === 'admin';
}

function visibleEmployees() {
  const query = document.getElementById('archiveSearch').value.trim().toLowerCase();
  if (!query) return employees;
  return employees.filter(employee => [employee.name, employee.position, employee.city, employee.email]
    .some(value => String(value || '').toLowerCase().includes(query)));
}

function syncSelectionUi() {
  const visibleIds = visibleEmployees().map(employee => Number(employee.id));
  const selectedVisible = visibleIds.filter(id => selectedIds.has(id)).length;
  const selectAll = document.getElementById('selectAllArchived');
  selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  document.getElementById('restoreSelected').disabled = selectedIds.size === 0;
}

function render() {
  const items = visibleEmployees();
  const tbody = document.getElementById('employeesTbody');
  document.getElementById('employeeArchiveCount').textContent = `В архиве: ${employees.length}`;

  if (!items.length) {
    const message = document.getElementById('archiveSearch').value ? 'По вашему запросу ничего не найдено' : 'В архиве нет сотрудников';
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">${message}</td></tr>`;
    syncSelectionUi();
    return;
  }

  tbody.innerHTML = items.map(employee => `
    <tr>
      <td class="col-check" data-label="Выбрать" style="text-align:center;">
        <input type="checkbox" class="emp-check" data-id="${employee.id}" ${selectedIds.has(Number(employee.id)) ? 'checked' : ''} aria-label="Выбрать ${escHtml(employee.name)}">
      </td>
      <td class="employee-primary col-employee" data-label="Сотрудник" style="text-align:left;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="employee-avatar-wrap">
            ${employee.photo
              ? `<div class="avatar" style="background-image:url('/uploads/${escHtml(employee.photo)}');background-size:cover;background-position:center;color:transparent;">${escHtml(initials(employee.name))}</div>`
              : `<div class="avatar">${escHtml(initials(employee.name))}</div>`}
            ${employee.is_rp ? '<span class="employee-rp-marker">РП</span>' : ''}
          </div>
          <div>
            <div class="employee-name"><a href="${escHtml(employeeProfileLink(employee))}">${escHtml(employee.name)}</a> <i class="fi fi-rr-box" style="font-size:.7rem;color:var(--text-muted)"></i></div>
            <div style="font-size:.75rem;color:var(--text-muted);" title="${escHtml(employee.email || '')}">${employee.email ? (employee.email.length > 12 ? `${escHtml(employee.email.substring(0, 12))}...` : escHtml(employee.email)) : '—'}</div>
          </div>
        </div>
      </td>
      <td class="col-role" data-label="Должность" style="text-align:left;"><span class="employee-pos" style="display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(employee.position || '')}">${escHtml(employee.position || '—')}</span></td>
      <td class="col-city" data-label="Город" style="text-align:left;"><span class="employee-city">${escHtml(employee.city || '—')}</span></td>
      <td class="col-status" data-label="Статус и дата" style="text-align:left;">
        <div class="employee-status-wrap"><span class="badge badge-muted">Архив</span><span class="employee-updated">Обновлено ${escHtml(formatDate(employee.updated_at))}</span></div>
      </td>
      <td class="col-link" data-label="Ссылка" style="text-align:center;"><span style="color:var(--text-muted)">—</span></td>
      <td class="col-resume" data-label="Резюме" style="text-align:center;"><span style="color:var(--text-muted)">—</span></td>
      <td class="col-actions" data-label="Действия" style="text-align:center;">
        <div class="action-menu archive-action-menu">
          <button class="btn btn-primary btn-icon" type="button" onclick="restoreEmployee(${employee.id})" title="Восстановить" aria-label="Восстановить ${escHtml(employee.name)}"><i class="fi fi-rr-undo"></i></button>
          ${isDepartmentAdmin() ? `<button class="btn btn-icon archive-delete-button" type="button" onclick="deleteEmployeePermanently(${employee.id})" title="Удалить безвозвратно" aria-label="Удалить безвозвратно ${escHtml(employee.name)}"><i class="fi fi-rr-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`).join('');
  syncSelectionUi();
}

async function loadArchive() {
  const response = await fetch('/api/employees');
  if (response.status === 401) return location.href = '/login.html';
  if (!response.ok) throw new Error('Не удалось загрузить архив сотрудников');
  employees = (await response.json()).filter(employee => employee.status === 'archived');
  selectedIds.forEach(id => {
    if (!employees.some(employee => Number(employee.id) === id)) selectedIds.delete(id);
  });
  render();
}

async function restoreEmployee(id, quiet = false) {
  const response = await fetch(`/api/employees/${id}/restore`, { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось восстановить сотрудника');
  employees = employees.filter(employee => Number(employee.id) !== Number(id));
  selectedIds.delete(Number(id));
  if (!quiet) toast('Сотрудник восстановлен', 'success');
  render();
}

async function deleteEmployeePermanently(id) {
  const employee = employees.find(item => Number(item.id) === Number(id));
  if (!employee || !confirm(`Удалить сотрудника «${employee.name}» безвозвратно? Восстановить его данные будет невозможно.`)) return;
  const response = await fetch(`/api/employees/${id}/permanent`, { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.error || 'Не удалось удалить сотрудника', 'error');
  employees = employees.filter(item => Number(item.id) !== Number(id));
  selectedIds.delete(Number(id));
  toast('Сотрудник удалён безвозвратно', 'success');
  render();
}

document.getElementById('archiveSearch').addEventListener('input', render);
document.getElementById('selectAllArchived').addEventListener('change', event => {
  visibleEmployees().forEach(employee => {
    const id = Number(employee.id);
    if (event.target.checked) selectedIds.add(id); else selectedIds.delete(id);
  });
  render();
});

document.getElementById('employeesTbody').addEventListener('change', event => {
  if (!event.target.classList.contains('emp-check')) return;
  const id = Number(event.target.dataset.id);
  if (event.target.checked) selectedIds.add(id); else selectedIds.delete(id);
  syncSelectionUi();
});

document.getElementById('restoreSelected').addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (!ids.length || !confirm(`Восстановить выбранных сотрудников (${ids.length})?`)) return;
  const button = document.getElementById('restoreSelected');
  button.disabled = true;
  try {
    for (const id of ids) await restoreEmployee(id, true);
    toast(`Восстановлено сотрудников: ${ids.length}`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = selectedIds.size === 0;
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
  const auth = await fetch('/api/auth/me').then(response => response.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) return location.href = '/login.html';
  currentManager = auth.manager;
  if (localStorage.getItem('theme') === 'light') document.getElementById('themeToggle').innerHTML = '<i class="fi fi-rr-sun"></i>';
  try {
    await loadArchive();
  } catch (error) {
    document.getElementById('employeesTbody').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger)">${escHtml(error.message)}</td></tr>`;
  }
})();
