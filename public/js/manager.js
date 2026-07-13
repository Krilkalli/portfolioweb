function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'none'; t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

// ─── Data ───────────────────────────────────────────────────────────────────
let employees = [];
let positionsList = [];
let selectedIds = new Set();

async function loadStats() {
  try {
    const r = await fetch('/api/stats');
    const s = await r.json();
    document.getElementById('statTotal').textContent = s.total;
    document.getElementById('statPending').textContent = s.pending;
    document.getElementById('statApproved').textContent = s.approved;

    const badge = document.getElementById('pendingBadge');
    if (s.pending > 0) { badge.textContent = s.pending; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  } catch {}
}

async function loadEmployees() {
  try {
    const r = await fetch('/api/employees');
    if (r.status === 401) { location.href = '/login.html'; return; }
    employees = await r.json();
    applyFilter();
  } catch (e) {
    document.getElementById('employeesTbody').innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:40px">Ошибка загрузки данных</td></tr>`;
  }
}

async function loadPositions() {
  try {
    const r = await fetch('/api/positions');
    if (r.ok) {
      const d = await r.json();
      positionsList = d.positions || [];
      populatePositionSelects();
    }
  } catch {}
}

function populatePositionSelects() {
  const selects = document.querySelectorAll('select[id="new_position"]');
  selects.forEach(sel => {
    sel.innerHTML = '<option value="">— Не выбрана —</option>';
    positionsList.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });
  });
  // Also populate the filter dropdown
  const filterSel = document.getElementById('filterPosition');
  if (filterSel) {
    const curr = filterSel.value;
    filterSel.innerHTML = '<option value="">— Все должности —</option>';
    positionsList.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      filterSel.appendChild(opt);
    });
    filterSel.value = curr;
  }
}

function renderTable(list) {
  const tbody = document.getElementById('employeesTbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">Ничего не найдено</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(e => `
    <tr class="${e.status === 'archived' ? 'row-archived' : ''}">
      <td class="col-check">
        <input type="checkbox" class="emp-check" data-id="${e.id}" ${selectedIds.has(e.id) ? 'checked' : ''} ${e.status === 'archived' ? 'disabled' : ''}>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar" style="${e.status === 'archived' ? 'opacity:0.4' : ''}">${initials(e.name)}</div>
          <div>
            <div class="employee-name"><a href="${e.link}&mode=view" target="_blank" rel="noopener">${e.name}</a>${e.status === 'archived' ? ' <span style="font-size:0.7rem;color:var(--text-muted)">📦</span>' : ''}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">${e.email || '—'}</div>
          </div>
        </div>
      </td>
      <td><span class="employee-pos">${e.position || '—'}</span></td>
      <td><span style="font-size:0.82rem;color:var(--text-secondary)">${e.city || '—'}</span></td>
      <td>
        ${e.status === 'archived'
          ? '<span class="badge badge-muted">Архив</span>'
          : e.pendingCount > 0
            ? `<span class="badge badge-warning">⚡ ${e.pendingCount} изм.</span>`
            : `<span class="badge badge-muted">Актуально</span>`}
      </td>
      <td style="font-size:0.82rem;color:var(--text-muted);white-space:nowrap;">${formatDate(e.updated_at)}</td>
      <td class="col-link">
        ${e.status !== 'archived'
          ? `<div style="display:flex;align-items:center;gap:4px;max-width:220px;">
              <a class="link-cell" href="${e.link}" target="_blank" rel="noopener" title="${e.link}">${e.link}</a>
              <button class="btn btn-ghost btn-icon" style="width:26px;height:26px;font-size:0.7rem;flex-shrink:0;" onclick="copyToClipboard('${e.link}')" title="Скопировать ссылку">📋</button>
            </div>`
          : '<span style="font-size:0.82rem;color:var(--text-muted)">—</span>'}
      </td>
      <td class="col-resume">
        ${e.status !== 'archived'
          ? `<div class="resume-menu" style="position:relative;display:inline-flex;">
              <button class="btn btn-primary btn-sm" onclick="toggleResumeMenu(this)" style="min-width:80px;">📄 Резюме</button>
              <div class="resume-dropdown">
                <a class="resume-dropdown-item" href="/api/employees/${e.id}/resume?format=docx" target="_blank">📄 Word (DOCX)</a>
                <a class="resume-dropdown-item" href="/api/employees/${e.id}/resume?format=pdf" target="_blank">📑 PDF</a>
              </div>
            </div>`
          : '<span style="font-size:0.82rem;color:var(--text-muted)">—</span>'}
      </td>
      <td class="col-actions">
        <div class="action-menu" style="position:relative;display:inline-flex;">
          ${e.status === 'archived'
            ? `<button class="btn btn-primary btn-sm" onclick="restoreEmployee(${e.id}, '${e.name.replace(/'/g, "\\'")}')">↩ Восстановить</button>`
            : `<button class="btn btn-ghost btn-sm action-menu-btn" onclick="toggleActionMenu(this)" style="font-size:1.2rem;line-height:1;padding:4px 10px;letter-spacing:2px;">⋮</button>
               <div class="action-dropdown">
                 <button class="action-dropdown-item" onclick="regenerateToken(${e.id}, '${e.name.replace(/'/g, "\\'")}')">🔄 Новая ссылка</button>
                 <button class="action-dropdown-item" onclick="archiveEmployee(${e.id}, '${e.name.replace(/'/g, "\\'")}')">📦 Архив</button>
               </div>`}
        </div>
      </td>
    </tr>
  `).join('');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast('Ссылка скопирована', 'success')).catch(() => {});
}

function toggleResumeMenu(btn) {
  document.querySelectorAll('.resume-dropdown.show').forEach(el => { if (el !== btn.nextElementSibling) el.classList.remove('show'); });
  const menu = btn.nextElementSibling;
  if (menu) menu.classList.toggle('show');
}

function toggleActionMenu(btn) {
  document.querySelectorAll('.action-dropdown.show').forEach(el => { if (el !== btn.nextElementSibling) el.classList.remove('show'); });
  const menu = btn.nextElementSibling;
  if (menu) menu.classList.toggle('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.action-menu')) {
    document.querySelectorAll('.action-dropdown.show').forEach(el => el.classList.remove('show'));
  }
  if (!e.target.closest('.resume-menu')) {
    document.querySelectorAll('.resume-dropdown.show').forEach(el => el.classList.remove('show'));
  }
});

async function regenerateToken(id, name) {
  if (!confirm(`Сгенерировать новую ссылку для ${name}?\nСтарая ссылка перестанет работать.`)) return;
  try {
    const r = await fetch(`/api/employees/${id}/new-token`, { method: 'POST' });
    const d = await r.json();
    toast(`Новая ссылка создана для ${name}`, 'success');
    await loadEmployees();
    navigator.clipboard.writeText(d.link).catch(() => {});
  } catch { toast('Ошибка при обновлении ссылки', 'error'); }
}

async function archiveEmployee(id, name) {
  if (!confirm(`Архивировать сотрудника «${name}»?\nОн будет скрыт из основного списка, но данные сохранятся.`)) return;
  try {
    const r = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    if (r.ok) {
      toast(`Сотрудник «${name}» архивирован`, 'info');
      await loadEmployees();
      await loadStats();
    } else {
      const d = await r.json().catch(() => ({}));
      toast(d.error || 'Ошибка при архивации', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
}

async function restoreEmployee(id, name) {
  try {
    const r = await fetch(`/api/employees/${id}/restore`, { method: 'POST' });
    if (r.ok) {
      toast(`Сотрудник «${name}» восстановлен`, 'success');
      await loadEmployees();
      await loadStats();
    } else { toast('Ошибка восстановления', 'error'); }
  } catch { toast('Ошибка соединения', 'error'); }
}

// ─── Add Employee ────────────────────────────────────────────────────────────
document.getElementById('addEmployeeBtn').addEventListener('click', () => {
  document.getElementById('addEmployeeModal').classList.add('active');
  document.getElementById('addResult').innerHTML = '';
  document.getElementById('addEmployeeForm').reset();
  populatePositionSelects();
});

document.getElementById('closeAddModal').addEventListener('click', () => {
  document.getElementById('addEmployeeModal').classList.remove('active');
});
document.getElementById('cancelAdd').addEventListener('click', () => {
  document.getElementById('addEmployeeModal').classList.remove('active');
});
document.getElementById('addEmployeeModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('addEmployeeModal').classList.remove('active');
});

document.getElementById('addEmployeeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('saveNewBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Создание...';

  const payload = {
    name: document.getElementById('new_name').value.trim(),
    position: document.getElementById('new_position').value,
    email: document.getElementById('new_email').value.trim(),
    city: document.getElementById('new_city').value.trim(),
  };

  if (!payload.name) {
    toast('Укажите ФИО сотрудника', 'error');
    btn.disabled = false;
    btn.innerHTML = '➕ Добавить и скопировать ссылку';
    return;
  }

  try {
    const r = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (r.ok) {
      toast(`Сотрудник ${payload.name} добавлен`, 'success');
      document.getElementById('addEmployeeModal').classList.remove('active');
      navigator.clipboard.writeText(d.employee.link).catch(() => {});
      document.getElementById('addResult').innerHTML = `
        <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:12px;font-size:0.85rem;">
          ✅ Сотрудник добавлен. Ссылка скопирована в буфер обмена.<br>
          <a href="${d.employee.link}" target="_blank" style="font-size:0.8rem;">${d.employee.link}</a>
        </div>`;
      await loadEmployees();
      await loadStats();
    } else {
      toast(d.error || 'Ошибка создания', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
  btn.disabled = false;
  btn.innerHTML = '➕ Добавить и скопировать ссылку';
});

// ─── Search & Filter ──────────────────────────────────────────────────────────
let showArchived = true;

document.getElementById('filterArchived').addEventListener('change', (e) => {
  showArchived = e.target.checked;
  applyFilter();
});

document.getElementById('searchInput').addEventListener('input', () => { applyFilter(); });
document.getElementById('filterPosition').addEventListener('change', () => { applyFilter(); });

function applyFilter() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const pos = document.getElementById('filterPosition').value;
  let list = employees;
  if (!showArchived) list = list.filter(e => e.status !== 'archived');
  if (pos) list = list.filter(e => e.position === pos);
  list = list.filter(emp =>
    emp.name.toLowerCase().includes(q) ||
    (emp.position || '').toLowerCase().includes(q) ||
    (emp.city || '').toLowerCase().includes(q)
  );
  renderTable(list);
}

// ─── Logout ──────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

// ─── Selection & Export ──────────────────────────────────────────────────────
function updateSelectionUI() {
  const toolbar = document.getElementById('exportToolbar');
  const count = document.getElementById('selectedCount');
  if (selectedIds.size > 0) {
    toolbar.style.display = 'flex';
    count.textContent = `Выбрано: ${selectedIds.size}`;
  } else {
    toolbar.style.display = 'none';
  }
  const selectAll = document.getElementById('selectAll');
  const checks = document.querySelectorAll('.emp-check');
  const activeChecks = Array.from(checks).filter(c => !c.disabled);
  if (activeChecks.length > 0) {
    selectAll.checked = activeChecks.every(c => c.checked);
    selectAll.indeterminate = activeChecks.some(c => c.checked) && !activeChecks.every(c => c.checked);
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
}

document.getElementById('selectAll').addEventListener('change', (e) => {
  const checks = document.querySelectorAll('.emp-check');
  checks.forEach(c => {
    if (!c.disabled) {
      c.checked = e.target.checked;
      const id = Number(c.dataset.id);
      if (e.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
    }
  });
  updateSelectionUI();
});

document.getElementById('employeesTbody').addEventListener('change', (e) => {
  if (e.target.classList.contains('emp-check')) {
    const id = Number(e.target.dataset.id);
    if (e.target.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectionUI();
  }
});

document.getElementById('clearSelectionBtn').addEventListener('click', () => {
  selectedIds.clear();
  document.querySelectorAll('.emp-check').forEach(c => { c.checked = false; });
  document.getElementById('selectAll').checked = false;
  updateSelectionUI();
});

async function exportSelected(format) {
  if (selectedIds.size === 0) { toast('Сначала выберите сотрудников', 'warning'); return; }
  const btn = format === 'pdf' ? document.getElementById('exportPdfBtn') : document.getElementById('exportDocxBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Генерация...';
  try {
    const r = await fetch('/api/employees/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds), format }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(d.error || 'Ошибка экспорта', 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumes_${format}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`ZIP-архив с ${selectedIds.size} резюме (${format.toUpperCase()}) скачан`, 'success');
  } catch {
    toast('Ошибка при экспорте', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

document.getElementById('exportDocxBtn').addEventListener('click', () => exportSelected('docx'));
document.getElementById('exportPdfBtn').addEventListener('click', () => exportSelected('pdf'));

document.getElementById('exportExcelBtn').addEventListener('click', async () => {
  if (selectedIds.size === 0) { toast('Сначала выберите сотрудников', 'warning'); return; }
  const btn = document.getElementById('exportExcelBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Генерация...';
  try {
    const r = await fetch('/api/employees/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(d.error || 'Ошибка экспорта', 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_selected_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Excel-файл с ${selectedIds.size} сотрудниками скачан`, 'success');
  } catch {
    toast('Ошибка при экспорте', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────
(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }

  const nm = document.getElementById('navbarManager');
  if (nm && auth.manager) nm.textContent = auth.manager.name + ' —';

  initTheme();
  await Promise.all([loadStats(), loadEmployees(), loadPositions()]);
})();
