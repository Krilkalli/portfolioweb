let currentManager = null;

function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  t.innerHTML = `<span>${icons[type]}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
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

// ─── Positions ──────────────────────────────────────────────────────────────
let positions = [];

async function loadPositions() {
  try {
    const r = await fetch('/api/positions');
    if (r.ok) { const d = await r.json(); positions = d.positions || []; renderPositions(); }
  } catch {}
}

function renderPositions() {
  const list = document.getElementById('positionList');
  if (!list) return;
  if (positions.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Нет добавленных должностей</p>';
    return;
  }
  list.innerHTML = positions.map(p => `
    <div class="position-item">
      <span>${p}</span>
      <button class="remove-pos" onclick="removePosition('${p.replace(/'/g, "\\'")}')">✕</button>
    </div>
  `).join('');
}

async function removePosition(name) {
  if (!confirm(`Удалить должность «${name}»?`)) return;
  try {
    const r = await fetch(`/api/positions/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r.ok) {
      const d = await r.json();
      positions = d.positions || [];
      renderPositions();
      toast(`Должность «${name}» удалена`, 'info');
    } else { toast('Ошибка удаления', 'error'); }
  } catch { toast('Ошибка соединения', 'error'); }
}

document.getElementById('addPositionBtn').addEventListener('click', async () => {
  const input = document.getElementById('newPositionInput');
  const name = input.value.trim();
  if (!name) { toast('Введите название должности', 'warning'); return; }

  try {
    const r = await fetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      const d = await r.json();
      positions = d.positions || [];
      renderPositions();
      input.value = '';
      toast(`Должность «${name}» добавлена`, 'success');
    } else {
      const d = await r.json();
      toast(d.error || 'Ошибка добавления', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
});

document.getElementById('newPositionInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addPositionBtn').click(); }
});

// ─── Settings Load ──────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    if (r.status === 401) { location.href = '/login.html'; return; }
    const s = await r.json();

    document.getElementById('smtp_host').value    = s.smtp_host    || '';
    document.getElementById('smtp_port').value    = s.smtp_port    || '587';
    document.getElementById('smtp_user').value    = s.smtp_user    || '';
    document.getElementById('smtp_from').value    = s.smtp_from    || '';
    document.getElementById('manager_email').value = s.manager_email || '';
  } catch { toast('Не удалось загрузить настройки', 'error'); }
}

// ─── Save SMTP ──────────────────────────────────────────────────────────────
document.getElementById('smtpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('saveSmtpBtn');
  const result = document.getElementById('smtpResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Сохранение...';

  const payload = {
    smtp_host:     document.getElementById('smtp_host').value.trim(),
    smtp_port:     document.getElementById('smtp_port').value.trim(),
    smtp_user:     document.getElementById('smtp_user').value.trim(),
    smtp_from:     document.getElementById('smtp_from').value.trim(),
    manager_email: document.getElementById('manager_email').value.trim(),
  };
  const pass = document.getElementById('smtp_pass').value;
  if (pass) payload.smtp_pass = pass;

  try {
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      toast('Настройки сохранены', 'success');
      result.style.color = 'var(--success)';
      result.textContent = '✅ Настройки успешно сохранены';
      document.getElementById('smtp_pass').value = '';
    } else { const d = await r.json(); toast(d.error || 'Ошибка сохранения', 'error'); }
  } catch { toast('Ошибка соединения', 'error'); }
  finally {
    btn.disabled = false;
    btn.textContent = '💾 Сохранить настройки';
    setTimeout(() => { result.textContent = ''; }, 5000);
  }
});

// ─── Test SMTP ──────────────────────────────────────────────────────────────
document.getElementById('testEmailBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testEmailBtn');
  const result = document.getElementById('smtpResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Проверка...';

  try {
    const r = await fetch('/api/settings/test-email', { method: 'POST' });
    const d = await r.json();
    if (r.ok) { result.style.color = 'var(--success)'; result.textContent = `✅ ${d.message}`; toast('Соединение успешно!', 'success'); }
    else { result.style.color = 'var(--danger)'; result.textContent = `❌ ${d.error}`; toast('Ошибка соединения', 'error'); }
  } catch { result.style.color = 'var(--danger)'; result.textContent = '❌ Ошибка запроса'; }
  finally { btn.disabled = false; btn.textContent = '🔌 Проверить соединение'; }
});

// ─── Change Password ────────────────────────────────────────────────────────
document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('savePasswordBtn');
  const result = document.getElementById('passwordResult');
  const currentPass = document.getElementById('current_password').value;
  const newPass = document.getElementById('new_password').value;
  const confirm = document.getElementById('confirm_password').value;

  if (!currentPass) { result.style.color = 'var(--danger)'; result.textContent = '❌ Введите текущий пароль'; return; }
  if (newPass.length < 8) { result.style.color = 'var(--danger)'; result.textContent = '❌ Пароль должен быть не менее 8 символов'; return; }
  if (newPass !== confirm) { result.style.color = 'var(--danger)'; result.textContent = '❌ Пароли не совпадают'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Сохранение...';

  try {
    const r = await fetch('/api/managers/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
    });
    if (r.ok) { result.style.color = 'var(--success)'; result.textContent = '✅ Пароль успешно изменён'; toast('Пароль изменён', 'success'); document.getElementById('current_password').value = ''; document.getElementById('new_password').value = ''; document.getElementById('confirm_password').value = ''; }
    else { const d = await r.json(); result.style.color = 'var(--danger)'; result.textContent = `❌ ${d.error}`; }
  } catch { result.style.color = 'var(--danger)'; result.textContent = '❌ Ошибка соединения'; }
  finally { btn.disabled = false; btn.textContent = '🔑 Сменить пароль'; setTimeout(() => { result.textContent = ''; }, 6000); }
});

// ─── Managers Management ────────────────────────────────────────────────────
async function loadManagers() {
  try {
    const r = await fetch('/api/managers');
    if (r.ok) {
      const d = await r.json();
      renderManagers(d.managers);
    }
  } catch {}
}

function renderManagers(managers) {
  const list = document.getElementById('managerList');
  if (!list) return;
  if (!managers || managers.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Нет менеджеров</p>';
    return;
  }
  list.innerHTML = managers.map(m => `
    <div class="position-item">
      <div>
        <div style="font-weight:600;font-size:0.9rem;">${escHtml(m.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${escHtml(m.email)}${m.id === currentManager?.id ? ' <span class="badge badge-accent" style="font-size:0.65rem;">Вы</span>' : ''}</div>
      </div>
      ${m.id !== currentManager?.id
        ? `<button class="remove-pos" onclick="confirmDeleteManager(${m.id}, '${escHtml(m.name)}')">✕</button>`
        : ''}
    </div>
  `).join('');
}

function confirmDeleteManager(id, name) {
  if (!confirm(`Удалить менеджера «${name}»?`)) return;
  deleteManager(id);
}

async function deleteManager(id) {
  try {
    const r = await fetch(`/api/managers/${id}`, { method: 'DELETE' });
    if (r.ok) {
      toast('Менеджер удалён', 'info');
      await loadManagers();
    } else {
      const d = await r.json();
      toast(d.error || 'Ошибка удаления', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
}

document.getElementById('addManagerBtn').addEventListener('click', async () => {
  const name = document.getElementById('newManagerName').value.trim();
  const login = document.getElementById('newManagerLogin').value.trim();
  const password = document.getElementById('newManagerPass').value;

  if (!name) { toast('Введите имя менеджера', 'warning'); return; }
  if (!login) { toast('Введите логин', 'warning'); return; }
  if (password.length < 8) { toast('Пароль должен быть не менее 8 символов', 'warning'); return; }

  try {
    const r = await fetch('/api/managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, login, password }),
    });
    if (r.ok) {
      toast(`Менеджер «${name}» добавлен`, 'success');
      document.getElementById('newManagerName').value = '';
      document.getElementById('newManagerLogin').value = '';
      document.getElementById('newManagerPass').value = '';
      await loadManagers();
    } else {
      const d = await r.json();
      toast(d.error || 'Ошибка добавления', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
});

// ─── Logout ─────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Template Upload ─────────────────────────────────────────────────────────
async function loadTemplateInfo() {
  try {
    const r = await fetch('/api/template/info');
    const d = await r.json();
    const el = document.getElementById('templateInfo');
    if (d.custom) el.innerHTML = '<span style="color:var(--success)">✅ Пользовательский шаблон загружен</span>';
    else el.innerHTML = '<span style="color:var(--text-muted)">📄 Используется базовый шаблон</span>';
  } catch {}
}

document.getElementById('templateUploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = document.getElementById('templateFile').files[0];
  if (!file) { toast('Выберите DOCX-файл', 'warning'); return; }
  const btn = document.getElementById('uploadTemplateBtn');
  const result = document.getElementById('templateResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Загрузка...';
  const fd = new FormData();
  fd.append('template', file);
  try {
    const r = await fetch('/api/template/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (r.ok) { result.textContent = '✅ Шаблон загружен'; result.style.color = 'var(--success)'; toast('Шаблон загружен', 'success'); loadTemplateInfo(); }
    else { result.textContent = '❌ ' + (d.error || 'Ошибка'); result.style.color = 'var(--danger)'; }
  } catch { result.textContent = '❌ Ошибка соединения'; result.style.color = 'var(--danger)'; }
  finally { btn.disabled = false; btn.textContent = '📤 Загрузить шаблон'; setTimeout(() => { result.textContent = ''; }, 5000); }
});

// ─── Init ────────────────────────────────────────────────────────────────────
(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }
  currentManager = auth.manager;
  document.getElementById('currentManagerLogin').textContent = currentManager?.email || '';

  initTheme();
  await Promise.all([loadSettings(), loadPositions(), loadManagers(), loadTemplateInfo()]);
})();
