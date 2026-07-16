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
let filterData = { positions: [], cities: [], certifications: [] };
let selectedIds = new Set();
let currentManager = null;
let selectedCerts = new Set();

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

async function loadFilterData() {
  try {
    const r = await fetch('/api/filter-data');
    if (r.ok) {
      filterData = await r.json();
      populateCitySelect();
      populateCertFilter();
    }
  } catch {}
}

function populateCitySelect() {
  const sel = document.getElementById('filterCity');
  if (!sel) return;
  const curr = sel.value;
  sel.innerHTML = '<option value="">— Все города —</option>';
  (filterData.cities || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c; sel.appendChild(opt);
  });
  sel.value = curr;
}

function populateCertFilter() {
  const list = document.getElementById('certFilterList');
  if (!list) return;
  list.innerHTML = '';
  (filterData.certifications || []).forEach(cert => {
    const label = document.createElement('label');
    label.className = 'filter-cert-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cert;
    cb.checked = selectedCerts.has(cert);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCerts.add(cert); else selectedCerts.delete(cert);
      applyFilter();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + cert));
    list.appendChild(label);
  });
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
      <td class="col-check" style="text-align:center;">
        <input type="checkbox" class="emp-check" data-id="${e.id}" ${selectedIds.has(e.id) ? 'checked' : ''} ${e.status === 'archived' ? 'disabled' : ''}>
      </td>
      <td style="text-align:left;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${e.photo ? `<div class="avatar" style="background-image:url('/uploads/${e.photo}');background-size:cover;background-position:center;color:transparent;${e.status === 'archived' ? 'opacity:0.4' : ''}">${initials(e.name)}</div>` : `<div class="avatar" style="${e.status === 'archived' ? 'opacity:0.4' : ''}">${initials(e.name)}</div>`}
          <div>
            <div class="employee-name"><a href="${e.link.replace('&as', '&as=manager')}&mode=view" target="_blank" rel="noopener">${e.name}</a>${e.status === 'archived' ? ' <span style="font-size:0.7rem;color:var(--text-muted)">📦</span>' : ''}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.email || ''}">${e.email || '—'}</div>
          </div>
        </div>
      </td>
      <td style="text-align:left;">
        <span class="employee-pos" style="display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.position || ''}">${e.position || '—'}</span>
      </td>
      <td style="text-align:left;">
        <span style="font-size:0.82rem;color:var(--text-secondary)">${e.city || '—'}</span>
      </td>
      <td style="text-align:left;">
        ${e.status === 'archived'
          ? '<span class="badge badge-muted">Архив</span>'
            : e.pendingCount > 0
              ? `<a href="/review.html" class="badge badge-warning" style="text-decoration:none;cursor:pointer;">⚡ ${e.pendingCount} изм.</a>`
            : `<span class="badge badge-muted">Актуально</span>`}
      </td>
      <td style="text-align:left;font-size:0.82rem;color:var(--text-muted);white-space:nowrap;">${formatDate(e.updated_at)}</td>
      <td class="col-link" style="text-align:left;">
        ${e.status !== 'archived'
          ? `<div style="display:flex;align-items:center;gap:4px;max-width:220px;">
              <a class="link-cell" href="${e.link}" target="_blank" rel="noopener" title="${e.link}">${e.link}</a>
              <button class="btn btn-ghost btn-icon" style="width:26px;height:26px;font-size:0.7rem;flex-shrink:0;" onclick="copyToClipboard('${e.link}')" title="Скопировать ссылку">📋</button>
            </div>`
          : '<span style="font-size:0.82rem;color:var(--text-muted)">—</span>'}
      </td>
      <td class="col-resume" style="text-align:center;">
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
      <td class="col-actions" style="text-align:center;">
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
document.getElementById('filterCity').addEventListener('change', () => { applyFilter(); });

// ─── Filter Popup ───────────────────────────────────────────────────────────
document.getElementById('filterBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('filterMenu').classList.toggle('show');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#filterWrap')) {
    document.getElementById('filterMenu').classList.remove('show');
  }
});
document.getElementById('filterResetBtn').addEventListener('click', () => {
  document.getElementById('filterPosition').value = '';
  document.getElementById('filterCity').value = '';
  selectedCerts.clear();
  document.querySelectorAll('#certFilterList input[type="checkbox"]').forEach(cb => cb.checked = false);
  document.getElementById('certSearchInput').value = '';
  document.getElementById('searchInput').value = '';
  showArchived = true;
  document.getElementById('filterArchived').checked = true;
  applyFilter();
  document.getElementById('filterMenu').classList.remove('show');
});
document.getElementById('certSearchInput').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#certFilterList .filter-cert-item').forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});
document.getElementById('certSelectAll').addEventListener('click', () => {
  (filterData.certifications || []).forEach(c => selectedCerts.add(c));
  document.querySelectorAll('#certFilterList input[type="checkbox"]').forEach(cb => cb.checked = true);
  applyFilter();
});
document.getElementById('certClearAll').addEventListener('click', () => {
  selectedCerts.clear();
  document.querySelectorAll('#certFilterList input[type="checkbox"]').forEach(cb => cb.checked = false);
  applyFilter();
});

function applyFilter() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const pos = document.getElementById('filterPosition').value;
  const city = document.getElementById('filterCity').value;
  let list = employees;
  if (!showArchived) list = list.filter(e => e.status !== 'archived');
  if (pos) list = list.filter(e => e.position === pos);
  if (city) list = list.filter(e => e.city === city);
  if (selectedCerts.size > 0) {
    list = list.filter(e => {
      const cert = (e.certification || '').toLowerCase();
      return [...selectedCerts].some(c => cert.includes(c.toLowerCase()));
    });
  }
  list = list.filter(emp =>
    emp.name.toLowerCase().includes(q) ||
    (emp.position || '').toLowerCase().includes(q) ||
    (emp.city || '').toLowerCase().includes(q) ||
    (emp.email || '').toLowerCase().includes(q)
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

// // // ─── Import Excel Modal ──────────────────────────────────────────────────────
// // let importMode = null;

// // document.getElementById('importExcelBtn').addEventListener('click', () => {
// //   document.getElementById('importExcelModal').classList.add('active');
// //   document.getElementById('importResult').innerHTML = '';
// //   document.getElementById('importFileInput').value = '';
// //   importMode = null;
// // });

// // document.getElementById('closeImportModal').addEventListener('click', () => {
// //   document.getElementById('importExcelModal').classList.remove('active');
// // });
// // document.getElementById('importExcelModal').addEventListener('click', (e) => {
// //   if (e.target === e.currentTarget) document.getElementById('importExcelModal').classList.remove('active');
// // });

// // document.getElementById('importAddBtn').addEventListener('click', () => {
// //   importMode = 'add';
// //   document.getElementById('importFileInput').click();
// // });

// // document.getElementById('importReplaceBtn').addEventListener('click', () => {
// //   if (!confirm('ВНИМАНИЕ! Все текущие сотрудники будут ПОЛНОСТЬЮ УДАЛЕНЫ и заменены данными из файла.\n\nЭто действие необратимо. Продолжить?')) return;
// //   importMode = 'replace';
// //   document.getElementById('importFileInput').click();
// // });

// document.getElementById('importFileInput').addEventListener('change', async (e) => {
//   const file = e.target.files[0];
//   if (!file || !importMode) return;

//   const result = document.getElementById('importResult');
//   result.innerHTML = '<span class="spinner"></span> Импорт...';

//   const fd = new FormData();
//   fd.append('file', file);
//   fd.append('mode', importMode);

//   try {
//     const r = await fetch('/api/excel/import', { method: 'POST', body: fd });
//     const d = await r.json();
//     e.target.value = '';
//     if (r.ok) {
//       const modeText = d.mode === 'replace' ? 'Полная замена' : 'Добавление';
//       result.innerHTML = `<span style="color:var(--success)">✅ ${modeText} завершён: добавлено ${d.imported}, пропущено ${d.skipped}</span>`;
//       toast(`Импорт завершён: добавлено ${d.imported}, пропущено ${d.skipped} дубликатов`, 'success');
//       await loadEmployees();
//       await loadStats();
//     } else {
//       result.innerHTML = `<span style="color:var(--danger)">❌ ${d.error || 'Ошибка импорта'}</span>`;
//       toast(d.error || 'Ошибка импорта', 'error');
//     }
//   } catch {
//     result.innerHTML = '<span style="color:var(--danger)">❌ Ошибка при импорте файла</span>';
//     toast('Ошибка при импорте файла', 'error');
//   }
//   setTimeout(() => { result.innerHTML = ''; }, 6000);
// });

// ─── Mass Mail ────────────────────────────────────────────────────────────────

// Открыть модальное окно рассылки
document.getElementById('massMailBtn').addEventListener('click', () => {
  // Проверяем, есть ли выбранные сотрудники
  if (selectedIds.size === 0) {
    toast('Сначала выберите сотрудников в таблице', 'warning');
    return;
  }
  
  document.getElementById('massMailModal').classList.add('active');
  document.getElementById('massMailResult').innerHTML = '';
  
  // Показываем количество выбранных
  document.getElementById('selectedRecipientsInfo').textContent = `👥 Выбрано: ${selectedIds.size} сотрудников`;
});

// Закрыть модальное окно
document.getElementById('closeMassMailModal').addEventListener('click', () => {
  document.getElementById('massMailModal').classList.remove('active');
});
document.getElementById('cancelMassMailBtn').addEventListener('click', () => {
  document.getElementById('massMailModal').classList.remove('active');
});
document.getElementById('massMailModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('massMailModal').classList.remove('active');
});

// Отправка письма выбранным сотрудникам
document.getElementById('massMailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const subject = document.getElementById('mailSubject').value.trim();
  const body = document.getElementById('mailBody').value.trim();
  
  if (!subject || !body) { 
    toast('Заполните тему и текст письма', 'warning'); 
    return; 
  }

  if (selectedIds.size === 0) {
    toast('Нет выбранных сотрудников', 'warning');
    return;
  }

  const btn = document.getElementById('sendMassMailBtn');
  const result = document.getElementById('massMailResult');
  
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Отправка...';
  result.innerHTML = '';

  try {
    const r = await fetch('/api/mass-mailing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        htmlContent: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;border-radius:8px;">' +
          body.replace(/\n/g, '<br>') + '</div>',
        employeeIds: Array.from(selectedIds),
      }),
    });
    
    const d = await r.json();
    
    if (r.ok) {
      result.innerHTML = `<span style="color:var(--success)">✅ Отправлено: ${d.sent}, ошибок: ${d.failed}</span>`;
      toast(`Рассылка завершена: ${d.sent} успешно, ${d.failed} с ошибками`, d.failed === 0 ? 'success' : 'warning');
    } else {
      result.innerHTML = `<span style="color:var(--danger)">❌ ${d.error || 'Ошибка рассылки'}</span>`;
      toast(d.error || 'Ошибка рассылки', 'error');
    }
  } catch (err) {
    result.innerHTML = `<span style="color:var(--danger)">❌ Ошибка соединения</span>`;
    toast('Ошибка соединения', 'error');
  }
  
  btn.disabled = false;
  btn.innerHTML = '📧 Отправить выбранным';
});
// ─── Role-based UI ──────────────────────────────────────────────────────────
function applyRoleUI(role) {
  document.querySelectorAll('[data-role]').forEach(el => {
    const allowed = el.dataset.role.split(',').map(r => r.trim());
    if (!allowed.includes(role)) {
      el.style.display = 'none';
    }
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────
(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }

  currentManager = auth.manager;
  const nm = document.getElementById('navbarManager');
  if (nm && auth.manager) nm.textContent = auth.manager.name + ' —';

  initTheme();
  applyRoleUI(auth.manager?.role || 'admin');
  await Promise.all([loadStats(), loadEmployees(), loadPositions(), loadFilterData()]);
})();
