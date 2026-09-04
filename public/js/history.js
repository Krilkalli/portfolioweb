function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = '.3s';
    setTimeout(() => item.remove(), 300);
  }, 4000);
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '—';
}

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function formatEducation(raw) {
  const data = tryParseJson(raw);
  if (typeof data === 'string') return data;
  if (!Array.isArray(data)) return '';
  return data.map(item => [item.institution, item.degree, item.specialty, item.year].filter(Boolean).join(', ')).filter(Boolean).join('\n');
}

function formatExperience(raw) {
  const data = tryParseJson(raw);
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';
  const lines = data.total ? [`Общий стаж: ${data.total}`] : [];
  for (const job of data.jobs || []) {
    const value = [job.company, job.position, job.period].filter(Boolean).join(' — ');
    if (value) lines.push(value);
  }
  return lines.join('\n');
}

function formatProjects(raw) {
  const data = tryParseJson(raw);
  if (typeof data === 'string') return data;
  if (!Array.isArray(data)) return '';
  return data.map(project => [
    project.project_name && `Проект: ${project.project_name}`,
    project.period && `Период: ${project.period}`,
    project.client && `Заказчик: ${project.client}`,
    project.role && `Роль: ${project.role}`,
    project.project_description && `Описание: ${project.project_description}`,
    project.functional_area && `Функциональная область: ${project.functional_area}`,
    project.technologies && `Технологии: ${project.technologies}`,
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return 'Не заполнено';
  if (field === 'education') return formatEducation(value) || 'Не заполнено';
  if (field === 'experience') return formatExperience(value) || 'Не заполнено';
  if (field === 'project_experience') return formatProjects(value) || 'Не заполнено';
  return String(value);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function dayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Без даты';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = date.toDateString();
  if (key === today.toDateString()) return 'Сегодня';
  if (key === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
}

function changeCountLabel(count) {
  const value = Math.abs(Number(count) || 0);
  const lastTwo = value % 100;
  const last = value % 10;
  const word = lastTwo >= 11 && lastTwo <= 14
    ? 'изменений'
    : last === 1
      ? 'изменение'
      : last >= 2 && last <= 4
        ? 'изменения'
        : 'изменений';
  return `${value} ${word}`;
}

function initTheme() {
  const light = localStorage.getItem('theme') === 'light';
  document.body.classList.toggle('light-theme', light);
  document.getElementById('themeToggle').innerHTML = light ? '<i class="fi fi-rr-sun"></i>' : '<i class="fi fi-rr-moon"></i>';
}

let historyItems = [];
let canRevertHistory = false;

function changeHtml(item) {
  const oldValue = formatValue(item.field_name, item.old_value);
  const newValue = formatValue(item.field_name, item.new_value);
  const rejected = item.decision_status === 'rejected';
  const returned = Boolean(item.returned_to_pending_at);
  const status = returned
    ? { label:'На подтверждении', badge:'badge-warning' }
    : rejected
      ? { label:'Отклонено', badge:'badge-danger' }
      : { label:'Подтверждено', badge:'badge-success' };
  let auditText;
  if (returned) {
    auditText = `<i class="fi fi-rr-rotate-right"></i> Возвращено на подтверждение ${escHtml(formatDateTime(item.returned_to_pending_at))}, ${escHtml(item.returned_to_pending_by || 'проверяющий не указан')}`;
  } else if (rejected) {
    auditText = `<i class="fi fi-rr-cross-circle"></i> Отклонил: ${escHtml(item.reviewed_by || 'не указан')}${item.reject_reason ? ` · Причина: ${escHtml(item.reject_reason)}` : ''}`;
  } else {
    auditText = `<i class="fi fi-rr-check-circle"></i> Подтвердил: ${escHtml(item.reviewed_by || 'не указан')}`;
  }
  return `
    <details class="history-change${rejected ? ' is-reverted' : ''}">
      <summary>
        <span class="history-change-field">${escHtml(item.field_label || item.field_name)}</span>
        <span class="badge ${status.badge} history-change-status">${status.label}</span>
      </summary>
      <div class="history-change-body">
        <div class="history-diff">
          <div class="history-diff-col"><div class="history-diff-label">Было</div><div class="history-value">${escHtml(oldValue)}</div></div>
          <div class="history-diff-col"><div class="history-diff-label">Стало</div><div class="history-value">${escHtml(newValue)}</div></div>
        </div>
        <div class="history-action-bar">
          <span>${auditText}</span>
          ${canRevertHistory
            ? `<div class="history-action-buttons">
                <button type="button" class="btn btn-ghost btn-sm history-approve-btn" onclick="approveHistory(${Number(item.id)})"><i class="fi fi-rr-check"></i> Подтвердить</button>
                <button type="button" class="btn btn-ghost btn-sm history-reject-btn" onclick="rejectHistory(${Number(item.id)})"><i class="fi fi-rr-cross"></i> Отклонить</button>
                <button type="button" class="btn btn-ghost btn-sm history-return-btn" onclick="returnToPending(${Number(item.id)})"><i class="fi fi-rr-rotate-right"></i> Вернуть на подтверждение</button>
              </div>`
            : ''}
        </div>
      </div>
    </details>`;
}

function makeBatches(items) {
  const batches = new Map();
  for (const item of items) {
    const key = `${item.employee_id || item.employee_name}|${item.submitted_at || item.reviewed_at}`;
    if (!batches.has(key)) {
      batches.set(key, {
        employeeName: item.employee_name || 'Сотрудник удалён',
        employeePosition: item.employee_position || 'Должность не указана',
        reviewedAt: item.reviewed_at,
        reviewers: new Set(),
        items: [],
      });
    }
    const batch = batches.get(key);
    batch.items.push(item);
    if (item.reviewed_by) batch.reviewers.add(item.reviewed_by);
    if (new Date(item.reviewed_at).getTime() > new Date(batch.reviewedAt).getTime()) batch.reviewedAt = item.reviewed_at;
  }
  return [...batches.values()];
}

function batchHtml(batch) {
  const activeCount = batch.items.filter(item => item.decision_status === 'approved' && !item.reverted_at).length;
  const rejectedCount = batch.items.filter(item => item.decision_status === 'rejected' && !item.returned_to_pending_at).length;
  const reviewers = [...batch.reviewers].join(', ') || 'Не указан';
  return `
    <article class="history-batch">
      <div class="history-batch-head">
        <div class="history-person">
          <div class="avatar">${escHtml(initials(batch.employeeName))}</div>
          <div style="min-width:0;">
            <div class="history-person-name">${escHtml(batch.employeeName)}</div>
            <div class="history-person-position">${escHtml(batch.employeePosition)}</div>
          </div>
        </div>
        <div class="history-batch-meta">
          <span class="badge ${activeCount ? 'badge-success' : rejectedCount ? 'badge-danger' : 'badge-warning'}">${changeCountLabel(batch.items.length)}</span>
          <span><i class="fi fi-rr-user-check"></i> ${escHtml(reviewers)}</span>
          <span><i class="fi fi-rr-clock"></i> ${escHtml(formatDateTime(batch.reviewedAt))}</span>
        </div>
      </div>
      <div class="history-changes">${batch.items.map(changeHtml).join('')}</div>
    </article>`;
}

function renderHistory(items) {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  document.getElementById('historyCount').textContent = `Изменений: ${items.length}`;
  if (!items.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const groups = new Map();
  for (const batch of makeBatches(items)) {
    const label = dayLabel(batch.reviewedAt);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(batch);
  }

  list.innerHTML = [...groups.entries()].map(([label, group]) => `
    <section class="history-day">
      <div class="history-day-title"><i class="fi fi-rr-calendar-check"></i> ${escHtml(label)} <span class="badge badge-success">${group.length}</span></div>
      <div class="history-batch-list">${group.map(batchHtml).join('')}</div>
    </section>`).join('');
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function applyFilters() {
  const query = document.getElementById('historySearch').value.trim().toLowerCase();
  const selectedDate = document.getElementById('historyDate').value;
  document.getElementById('clearHistoryDate').classList.toggle('hidden', !selectedDate);
  renderHistory(historyItems.filter(item => {
    const matchesDate = !selectedDate || localDateKey(item.reviewed_at) === selectedDate;
    const matchesSearch = !query || [
      item.employee_name, item.employee_position, item.field_label, item.reviewed_by,
      item.reject_reason, item.reverted_by, item.returned_to_pending_by,
      item.decision_status === 'rejected' ? 'отклонено' : 'подтверждено',
      item.returned_to_pending_at ? 'на подтверждении' : '',
      formatValue(item.field_name, item.new_value),
    ].some(value => String(value || '').toLowerCase().includes(query));
    return matchesDate && matchesSearch;
  }));
}

async function approveHistory(id) {
  const item = historyItems.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  const confirmed = window.confirm(`Подтвердить изменение «${item.field_label || item.field_name}» у сотрудника ${item.employee_name}? Предложенное значение будет записано в портфолио.`);
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/approval-history/${id}/approve`, { method:'POST' });
    const data = await response.json();
    if (!response.ok) {
      toast(data.error || 'Не удалось подтвердить изменение', 'error');
      return;
    }
    toast('Изменение подтверждено и записано в портфолио', 'success');
    await loadHistory();
  } catch {
    toast('Ошибка соединения с сервером', 'error');
  }
}

async function rejectHistory(id) {
  const item = historyItems.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  const reason = window.prompt(`Укажите причину отклонения изменения «${item.field_label || item.field_name}» у сотрудника ${item.employee_name}:`, item.reject_reason || '');
  if (reason === null) return;

  try {
    const response = await fetch(`/api/approval-history/${id}/reject`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ reason:reason.trim() }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast(data.error || 'Не удалось отклонить изменение', 'error');
      return;
    }
    toast('Изменение отклонено, решение сохранено в истории', 'success');
    await loadHistory();
  } catch {
    toast('Ошибка соединения с сервером', 'error');
  }
}

async function returnToPending(id) {
  const item = historyItems.find(entry => Number(entry.id) === Number(id));
  if (!item) return;
  const confirmed = window.confirm(`Вернуть изменение «${item.field_label || item.field_name}» у сотрудника ${item.employee_name} на повторное подтверждение?`);
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/approval-history/${id}/return-to-pending`, { method:'POST' });
    const data = await response.json();
    if (!response.ok) {
      toast(data.error || 'Не удалось вернуть изменение на подтверждение', 'error');
      return;
    }
    toast('Изменение снова ожидает подтверждения', 'success');
    await loadHistory();
  } catch {
    toast('Ошибка соединения с сервером', 'error');
  }
}

async function loadHistory() {
  const loading = document.getElementById('historyLoading');
  try {
    const response = await fetch('/api/approval-history?limit=1000');
    if (response.status === 401) { location.href = '/login.html'; return; }
    if (!response.ok) throw new Error('Не удалось загрузить историю');
    const data = await response.json();
    historyItems = data.items || [];
    document.getElementById('historyActive').textContent = data.activeCount || 0;
    document.getElementById('historyRejected').textContent = data.rejectedCount || 0;
    document.getElementById('historyLatest').textContent = historyItems[0] ? formatDateTime(historyItems[0].reviewed_at) : 'Пока нет';
    applyFilters();
  } catch (error) {
    loading.innerHTML = `<p style="color:var(--danger)">${escHtml(error.message)}</p>`;
    return;
  }
  loading.classList.add('hidden');
}

document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const light = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', light ? 'light' : 'dark');
  document.getElementById('themeToggle').innerHTML = light ? '<i class="fi fi-rr-sun"></i>' : '<i class="fi fi-rr-moon"></i>';
});

document.getElementById('historySearch').addEventListener('input', applyFilters);
document.getElementById('historyDate').addEventListener('change', applyFilters);
document.getElementById('clearHistoryDate').addEventListener('click', () => {
  document.getElementById('historyDate').value = '';
  applyFilters();
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method:'POST' });
  location.href = '/login.html';
});

(async () => {
  const auth = await fetch('/api/auth/me').then(response => response.json()).catch(() => ({ authenticated:false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }
  if (auth.manager) document.getElementById('navbarManager').textContent = `${auth.manager.name} — ${auth.manager.email}`;
  canRevertHistory = ['admin', 'scrum', 'leader'].includes(auth.manager?.role);
  initTheme();
  await loadHistory();
})();
