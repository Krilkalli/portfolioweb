// ─── Утилиты ──────────────────────────────────────────────────────────────────
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

const FIELD_LABELS = {
  education: 'Образование',
  position: 'Должность',
  contacts: 'Контактные данные',
  experience: 'Стаж работы',
  about: 'Обо мне',
  competencies: 'Компетенции',
  project_experience: 'Проектный опыт',
  certification: 'Сертификация 1С',
};

// ─── Форматирование значений для «Было / Стало» ─────────────────────────────
// education/experience/project_experience хранятся как JSON (или как обычный
// текст, если данные пришли из Excel-импорта) — здесь превращаем их в
// читаемый текст вместо сырого {"total":"","jobs":[]}.
function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function formatEducation(raw) {
  const data = tryParseJson(raw);
  if (typeof data === 'string') return data;
  if (!Array.isArray(data) || data.length === 0) return '';
  return data
    .map(e => [e.institution, e.degree, e.specialty, e.year].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('; ');
}

function formatExperience(raw) {
  const data = tryParseJson(raw);
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';
  const lines = [];
  if (data.total) lines.push(`Общий стаж: ${data.total}`);
  if (Array.isArray(data.jobs)) {
    for (const j of data.jobs) {
      const parts = [j.company, j.position, j.period].filter(Boolean);
      if (parts.length) lines.push(parts.join(' — '));
    }
  }
  return lines.join('\n');
}

function formatProjectExperience(raw) {
  const data = tryParseJson(raw);
  if (typeof data === 'string') return data;
  if (!Array.isArray(data) || data.length === 0) return '';
  return data.map(p => {
    const lines = [];
    if (p.period) lines.push(`Период: ${p.period}`);
    if (p.client) lines.push(`Заказчик: ${p.client}`);
    if (p.position) lines.push(`Должность: ${p.position}`);
    if (p.role) lines.push(`Роль: ${p.role}`);
    if (p.team_size) lines.push(`Размер команды: ${p.team_size}`);
    if (p.project_description) lines.push(`Описание: ${p.project_description}`);
    if (p.task_description) lines.push(`Задачи: ${p.task_description}`);
    if (p.technologies) lines.push(`Технологии: ${p.technologies}`);
    return lines.join('\n');
  }).filter(Boolean).join('\n\n');
}

function formatDiffValue(fieldName, value) {
  if (value === null || value === undefined || value === '') return '';
  if (fieldName === 'education') return formatEducation(value);
  if (fieldName === 'experience') return formatExperience(value);
  if (fieldName === 'project_experience') return formatProjectExperience(value);
  return value;
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

// ─── State ──────────────────────────────────────────────────────────────────
let pendingGroups = [];
let rejectTargetId = null;
let rejectTargetType = null; // 'employee' | 'change'
let rejectTargetEmployeeId = null;
let approveTargetId = null;
let approveTargetType = null; // 'employee' | 'change'
let approveTargetEmployeeId = null;

// ─── Загрузка ─────────────────────────────────────────────────────────────────
async function loadPending() {
  const loading = document.getElementById('loadingState');
  const noChanges = document.getElementById('noChanges');
  const list = document.getElementById('reviewList');

  try {
    const r = await fetch('/api/pending');
    if (r.status === 401) { location.href = '/login.html'; return; }
    const d = await r.json();

    loading.classList.add('hidden');

    if (d.count === 0) {
      noChanges.classList.remove('hidden');
      document.getElementById('headerBadge').innerHTML = '';
      return;
    }

    pendingGroups = d.groups;
    document.getElementById('headerBadge').innerHTML =
      `<span class="badge badge-warning" style="font-size:0.9rem;padding:6px 14px;">⚡ ${d.count} сотрудников</span>`;

    list.innerHTML = '';
    for (const group of d.groups) {
      list.appendChild(renderEmployeeCard(group));
    }
  } catch (e) {
    loading.innerHTML = `<p style="color:var(--danger)">Ошибка загрузки. Обновите страницу.</p>`;
  }
}

function renderEmployeeCard(group) {
  const card = document.createElement('div');
  card.className = 'review-card';
  card.id = `emp-card-${group.employee_id}`;

  const submittedAt = group.changes[0]?.submitted_at
    ? new Date(group.changes[0].submitted_at).toLocaleString('ru-RU')
    : '—';

  card.innerHTML = `
    <div class="review-card-header">
      <div class="employee-info">
        ${group.employee_photo ? `<div class="avatar" style="background-image:url('/uploads/${group.employee_photo}');background-size:cover;background-position:center;color:transparent;">${initials(group.employee_name)}</div>` : `<div class="avatar">${initials(group.employee_name)}</div>`}
        <div>
          <div style="font-weight:600;">${group.employee_name}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);">${group.employee_position}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">Отправлено: ${submittedAt}</div>
        </div>
        <span class="badge badge-warning" style="margin-left:8px;">${group.changes.length} изм.</span>
      </div>
      <div class="actions">
        <button class="btn btn-success btn-sm" onclick="openApproveModal(${group.employee_id}, 'employee')">✅ Подтвердить всё</button>
        <button class="btn btn-danger btn-sm" onclick="openRejectModal(${group.employee_id}, 'employee')">❌ Отклонить всё</button>
      </div>
    </div>
    <div class="diff-wrap">
      ${group.changes.map(c => renderDiffField(c)).join('')}
    </div>
  `;
  return card;
}

function renderDiffField(change) {
  const label = FIELD_LABELS[change.field_name] || change.field_name;
  const oldVal = formatDiffValue(change.field_name, change.old_value) || '(пусто)';
  const newVal = formatDiffValue(change.field_name, change.new_value) || '(пусто)';

  return `
    <div class="diff-field" id="change-${change.id}">
      <div class="diff-field-label">
        <span>${label}</span>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-success btn-sm" style="height:26px;padding:0 10px;font-size:0.75rem;" onclick="openApproveModal(${change.id}, 'change', ${change.employee_id})">✅</button>
          <button class="btn btn-danger btn-sm" style="height:26px;padding:0 10px;font-size:0.75rem;" onclick="openRejectModal(${change.id}, 'change', ${change.employee_id})">❌</button>
        </div>
      </div>
      <div class="diff-cols">
        <div class="diff-col diff-col-old">
          <div class="diff-col-title">Было</div>
          <div class="diff-text old-text">${escHtml(oldVal)}</div>
        </div>
        <div class="diff-col diff-col-new">
          <div class="diff-col-title">Стало</div>
          <div class="diff-text new-text">${escHtml(newVal)}</div>
        </div>
      </div>
    </div>
  `;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Подтверждение ─────────────────────────────────────────────────────────────
async function approveAll(employeeId) {
  try {
    const r = await fetch(`/api/employees/${employeeId}/approve-all`, { method: 'POST' });
    const d = await r.json();
    if (r.ok) {
      toast(`Все изменения подтверждены (${d.applied} полей)`, 'success');
      removeEmployeeCard(employeeId);
    } else {
      toast(d.error, 'error');
    }
  } catch {
    toast('Ошибка при подтверждении', 'error');
  }
}

async function approveChange(changeId, employeeId) {
  try {
    const r = await fetch(`/api/pending/${changeId}/approve`, { method: 'POST' });
    if (r.ok) {
      toast('Изменение подтверждено', 'success');
      const el = document.getElementById(`change-${changeId}`);
      if (el) {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0';
        setTimeout(() => {
          el.remove();
          // Если больше нет изменений у сотрудника
          const card = document.getElementById(`emp-card-${employeeId}`);
          if (card && !card.querySelector('.diff-field')) removeEmployeeCard(employeeId);
        }, 300);
      }
    } else {
      toast('Ошибка', 'error');
    }
  } catch {
    toast('Ошибка при подтверждении', 'error');
  }
}

function removeEmployeeCard(employeeId) {
  const card = document.getElementById(`emp-card-${employeeId}`);
  if (card) {
    card.style.transition = 'opacity 0.3s, transform 0.3s';
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    setTimeout(() => {
      card.remove();
      // Проверить: остались ли карточки?
      if (!document.querySelector('.review-card')) {
        document.getElementById('noChanges').classList.remove('hidden');
        document.getElementById('headerBadge').innerHTML = '';
      }
    }, 300);
  }
}

// ─── Подтверждение с комментарием ─────────────────────────────────────────────
function openApproveModal(id, type, employeeId = null) {
  approveTargetId = id;
  approveTargetType = type;
  approveTargetEmployeeId = employeeId;
  document.getElementById('approveComment').value = '';
  document.getElementById('approveModal').classList.add('active');
}

document.getElementById('closeApproveModal').addEventListener('click', () => {
  document.getElementById('approveModal').classList.remove('active');
});
document.getElementById('cancelApprove').addEventListener('click', () => {
  document.getElementById('approveModal').classList.remove('active');
});
document.getElementById('approveModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('approveModal').classList.remove('active');
});

document.getElementById('confirmApprove').addEventListener('click', async () => {
  const comment = document.getElementById('approveComment').value.trim();
  document.getElementById('approveModal').classList.remove('active');

  try {
    let r;
    if (approveTargetType === 'employee') {
      r = await fetch(`/api/employees/${approveTargetId}/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      if (r.ok) {
        const d = await r.json();
        toast(`Все изменения подтверждены (${d.applied} полей)`, 'success');
        removeEmployeeCard(approveTargetId);
      }
    } else {
      r = await fetch(`/api/pending/${approveTargetId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      if (r.ok) {
        toast('Изменение подтверждено', 'success');
        const el = document.getElementById(`change-${approveTargetId}`);
        if (el) {
          el.style.transition = 'opacity 0.3s';
          el.style.opacity = '0';
          setTimeout(() => {
            el.remove();
            if (!document.querySelector('.diff-field')) removeEmployeeCard(approveTargetEmployeeId);
          }, 300);
        }
      }
    }
    if (!r.ok) {
      const d = await r.json();
      toast(d.error || 'Ошибка', 'error');
    }
  } catch {
    toast('Ошибка при подтверждении', 'error');
  }
});

// ─── Отклонение ───────────────────────────────────────────────────────────────
function openRejectModal(id, type, employeeId = null) {
  rejectTargetId = id;
  rejectTargetType = type;
  rejectTargetEmployeeId = employeeId;
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').classList.add('active');
}

document.getElementById('closeRejectModal').addEventListener('click', closeModal);
document.getElementById('cancelReject').addEventListener('click', closeModal);
document.getElementById('rejectModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

function closeModal() {
  document.getElementById('rejectModal').classList.remove('active');
}

document.getElementById('confirmReject').addEventListener('click', async () => {
  const reason = document.getElementById('rejectReason').value.trim();
  closeModal();

  try {
    let r;
    if (rejectTargetType === 'employee') {
      r = await fetch(`/api/employees/${rejectTargetId}/reject-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (r.ok) { toast('Все изменения отклонены', 'warning'); removeEmployeeCard(rejectTargetId); }
    } else {
      r = await fetch(`/api/pending/${rejectTargetId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (r.ok) {
        toast('Изменение отклонено', 'warning');
        const el = document.getElementById(`change-${rejectTargetId}`);
        if (el) { el.style.opacity = '0'; setTimeout(() => { el.remove(); if (!document.querySelector('.diff-field')) removeEmployeeCard(rejectTargetEmployeeId); }, 300); }
      }
    }
    if (!r.ok) toast('Ошибка при отклонении', 'error');
  } catch {
    toast('Ошибка при отклонении', 'error');
  }
});

// ─── Выход ────────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

// ─── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }

  const nm = document.getElementById('navbarManager');
  if (nm && auth.manager) nm.textContent = auth.manager.name + ' —';

  // Leader role: view-only, hide approve/reject buttons
  if (auth.manager?.role === 'leader') {
    document.querySelectorAll('.actions').forEach(el => el.style.display = 'none');
    document.querySelectorAll('[onclick*="approve"]').forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
    document.querySelectorAll('[onclick*="reject"]').forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
    document.querySelectorAll('[onclick*="openReject"]').forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
  }

  initTheme();
  await loadPending();
})();
