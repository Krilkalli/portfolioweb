let currentManager = null;

function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = { success: '<i class="fi fi-rr-check-circle"></i>', error: '<i class="fi fi-rr-cross-circle"></i>', info: '<i class="fi fi-rr-info"></i>', warning: '<i class="fi fi-rr-triangle-warning"></i>' };
  t.innerHTML = `<span>${icons[type]}</span> `;
  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  t.appendChild(textSpan);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Theme ──────────────────────────────────────────────────────────────────
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

// ─── Positions ──────────────────────────────────────────────────────────────
let positions = [];
let positionCompetencies = {};

async function loadPositions() {
  try {
    const r = await fetch('/api/positions');
    if (r.ok) { const d = await r.json(); positions = d.positions || []; renderPositions(); }
  } catch {}
}

async function loadPositionCompetencies() {
  try {
    const r = await fetch('/api/position-competencies');
    if (r.ok) { positionCompetencies = await r.json(); }
  } catch {}
  COMP_GROUPS.forEach(g => { if (!positionCompetencies[g]) positionCompetencies[g] = []; });
  renderCompList();
}

const COMP_GROUPS = ['Разработчик', 'Архитектор', 'Консультант'];

document.querySelectorAll('.comp-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.comp-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCompList();
  });
});

function getActiveGroup() {
  const active = document.querySelector('.comp-tab.active');
  return active ? active.getAttribute('data-group') : 'Разработчик';
}

function renderCompList() {
  const list = document.getElementById('compList');
  if (!list) return;
  const group = getActiveGroup();
  const comps = positionCompetencies[group] || [];
  if (comps.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;padding:8px 0;">Нет компетенций для этой группы</p>';
    return;
  }
  list.innerHTML = comps.map(c => `
    <div class="position-item">
      <span>${escHtml(c)}</span>
      <button class="remove-pos" onclick="removeComp('${escHtml(group).replace(/'/g, "\\'")}', '${escHtml(c).replace(/'/g, "\\'")}')">✕</button>
    </div>
  `).join('');
}

document.getElementById('addCompBtn')?.addEventListener('click', async () => {
  const group = getActiveGroup();
  const comp = document.getElementById('newCompInput').value.trim();
  if (!comp) { toast('Введите компетенцию', 'warning'); return; }
  try {
    const r = await fetch('/api/position-competencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: group, competency: comp }),
    });
    if (r.ok) {
      const d = await r.json();
      positionCompetencies[group] = d.competencies;
      renderCompList();
      document.getElementById('newCompInput').value = '';
      toast('Компетенция добавлена', 'success');
    } else {
      const d = await r.json();
      toast(d.error || 'Ошибка', 'error');
    }
  } catch { toast('Ошибка соединения', 'error'); }
});

document.getElementById('newCompInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addCompBtn').click(); }
});

async function removeComp(position, competency) {
  if (!confirm(`Удалить компетенцию «${competency}» из должности «${position}»?`)) return;
  try {
    const r = await fetch('/api/position-competencies', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, competency }),
    });
    if (r.ok) {
      const d = await r.json();
      positionCompetencies[position] = d.competencies;
      renderCompList();
      toast('Компетенция удалена', 'info');
    }
  } catch { toast('Ошибка соединения', 'error'); }
}

function renderPositions() {
  const list = document.getElementById('positionList');
  if (!list) return;
  renderAliases();
  if (positions.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Нет добавленных должностей</p>';
    return;
  }
  list.innerHTML = positions.map(p => `
    <div class="position-item">
      <span>${escHtml(p)}</span>
      <button class="remove-pos" onclick="removePosition('${escHtml(p).replace(/'/g, "\\'")}')">✕</button>
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

// ─── Position Aliases ────────────────────────────────────────────────────────
let positionAliases = {};
let useAliases = false;

async function loadPositionAliases() {
  try {
    const r = await fetch('/api/position-aliases');
    if (r.ok) {
      const d = await r.json();
      positionAliases = d.aliases || {};
      useAliases = d.useAliases || false;
      renderAliases();
    }
  } catch {}
}

function renderAliases() {
  const tbody = document.getElementById('aliasRows');
  if (!tbody) return;
  document.getElementById('useAliasesCheck').checked = useAliases;
  if (positions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.85rem;">Сначала добавьте должности</td></tr>';
    return;
  }
  tbody.innerHTML = positions.map(p => `
    <tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px 6px;font-size:0.85rem;">${escHtml(p)}</td>
      <td style="padding:4px 6px;">
        <input type="text" class="form-control alias-input" data-position="${escHtml(p).replace(/"/g, '&quot;')}" value="${escHtml(positionAliases[p] || '')}" placeholder="Например, ${escHtml(getExampleAlias(p))}" style="width:100%;font-size:0.85rem;padding:6px 8px;">
      </td>
    </tr>
  `).join('');
}

function getExampleAlias(pos) {
  const m = { 'Разработчик': 'Junior Developer', 'Архитектор': 'Junior Architect', 'Консультант': 'Junior Consultant' };
  return m[pos] || 'Junior ' + pos;
}

document.getElementById('saveAliasesBtn')?.addEventListener('click', async () => {
  const inputs = document.querySelectorAll('.alias-input');
  const aliases = {};
  inputs.forEach(inp => {
    const pos = inp.getAttribute('data-position');
    const val = inp.value.trim();
    if (val) aliases[pos] = val;
  });
  const useAliasesVal = document.getElementById('useAliasesCheck').checked;
  try {
    const r = await fetch('/api/position-aliases', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases, useAliases: useAliasesVal }),
    });
    if (r.ok) {
      positionAliases = aliases;
      useAliases = useAliasesVal;
      document.getElementById('aliasesResult').style.color = 'var(--success)';
      document.getElementById('aliasesResult').innerHTML = '<i class="fi fi-rr-check-circle"></i> Аналоги сохранены';
      toast('Аналоги должностей сохранены', 'success');
    } else {
      const d = await r.json();
      document.getElementById('aliasesResult').style.color = 'var(--danger)';
      document.getElementById('aliasesResult').innerHTML = '<i class="fi fi-rr-cross-circle"></i> ' + (d.error || 'Ошибка');
    }
  } catch {
    document.getElementById('aliasesResult').style.color = 'var(--danger)';
    document.getElementById('aliasesResult').innerHTML = '<i class="fi fi-rr-cross-circle"></i> Ошибка соединения';
  }
  setTimeout(() => { document.getElementById('aliasesResult').textContent = ''; }, 5000);
});

// ─── Feedback ─────────────────────────────────────────────────────────────────
async function loadFeedback() {
  try {
    const r = await fetch('/api/feedback');
    if (!r.ok) return;
    const d = await r.json();
    renderFeedback(d.feedback || []);
  } catch {}
}

function renderFeedback(list) {
  const tbody = document.getElementById('feedbackRows');
  const empty = document.getElementById('feedbackEmpty');
  const statsDiv = document.getElementById('feedbackStats');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    statsDiv.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0, sum = 0;

  tbody.innerHTML = list.map(f => {
    const r = Number(f.rating);
    if (r >= 1 && r <= 5) { ratingCounts[r]++; total++; sum += r; }
    const stars = r >= 1 && r <= 5 ? '★'.repeat(r) + '☆'.repeat(5 - r) : '—';
    const date = f.submitted_at ? new Date(f.submitted_at).toLocaleString('ru-RU') : '';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px 6px;">${escHtml(f.employee_name)}</td>
      <td style="padding:8px 6px;white-space:nowrap;">${stars}</td>
      <td style="padding:8px 6px;max-width:300px;word-break:break-word;">${escHtml(f.comment || '—')}</td>
      <td style="padding:8px 6px;white-space:nowrap;font-size:0.8rem;color:var(--text-muted);">${date}</td>
    </tr>`;
  }).join('');

  const avg = total > 0 ? (sum / total).toFixed(1) : '—';
  statsDiv.innerHTML = `
    <div class="stat-box"><strong>${list.length}</strong><br><span>Всего отзывов</span></div>
    <div class="stat-box"><strong>${avg}</strong><br><span>Средняя оценка</span></div>
    ${[5,4,3,2,1].map(i => `<div class="stat-box"><strong>${'★'.repeat(i)}${'☆'.repeat(5-i)}</strong><br><span>${ratingCounts[i]}</span></div>`).join('')}
  `;
}

async function summarizeFeedbackAI() {
  const btn = document.getElementById('btnSummarizeFeedback');
  const box = document.getElementById('feedbackSummaryBox');
  const originalHtml = btn.innerHTML;
  
  btn.innerHTML = '<span class="spinner"></span> ИИ анализирует...';
  btn.disabled = true;
  box.style.display = 'none';
  
  try {
    const res = await fetch('/api/feedback/summarize', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok) {
      box.style.display = 'block';
      box.innerHTML = '<strong>Резюме от ИИ:</strong><br><br>';
      const sumSpan = document.createElement('span');
      sumSpan.textContent = data.summary;
      sumSpan.innerHTML = sumSpan.innerHTML.replace(/\n/g, '<br>');
      box.appendChild(sumSpan);
      toast('Анализ успешно завершен', 'success');
    } else {
      throw new Error(data.error || 'Ошибка суммаризации');
    }
  } catch (err) {
    console.error(err);
    toast(err.message, 'error');
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

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

    // AI Settings
    if (document.getElementById('ai_base_url')) {
      document.getElementById('ai_base_url').value = s.ai_base_url || 'https://ai.wormsoft.ru/api/gpt';
      document.getElementById('ai_model_name').value = s.ai_model_name || 'openai/gpt-5.4-mini';
      document.getElementById('ai_prompt_fill').value = s.ai_prompt_fill || 'Ты опытный HR-специалист. Улучши стиль написания, исправь грамматические и орфографические ошибки в тексте, сохранив смысл. Текст должен звучать профессионально. Верни только исправленный текст без преамбул.';
      document.getElementById('ai_prompt_review').value = s.ai_prompt_review || 'Ты строгий HR-ревьюер. Проанализируй текст и укажи на несоответствия, логические или орфографические ошибки. Верни результат в виде краткого списка замечаний. Если всё отлично, напиши "Замечаний нет".';
      if (document.getElementById('ai_prompt_summarize')) {
        document.getElementById('ai_prompt_summarize').value = s.ai_prompt_summarize || 'Ты опытный HR-аналитик. Проанализируй список отзывов сотрудников о компании и составь краткое резюме: выдели основные плюсы, минусы и общие настроения.';
      }
    }
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
      result.innerHTML = '<i class="fi fi-rr-check-circle"></i> Настройки успешно сохранены';
      document.getElementById('smtp_pass').value = '';
    } else { const d = await r.json(); toast(d.error || 'Ошибка сохранения', 'error'); }
  } catch { toast('Ошибка сети', 'error'); }
  finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить настройки';
    setTimeout(() => { result.textContent = ''; }, 5000);
  }
});

// -- Save AI --
document.getElementById('aiForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('saveAiBtn');
  const result = document.getElementById('aiResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Сохранение...';

  const payload = {
    ai_base_url:      document.getElementById('ai_base_url').value.trim(),
    ai_model_name:    document.getElementById('ai_model_name').value.trim(),
    ai_prompt_fill:   document.getElementById('ai_prompt_fill').value.trim(),
    ai_prompt_review: document.getElementById('ai_prompt_review').value.trim(),
  };
  if (document.getElementById('ai_prompt_summarize')) {
    payload.ai_prompt_summarize = document.getElementById('ai_prompt_summarize').value.trim();
  }
  const key = document.getElementById('ai_api_key').value;
  if (key) payload.ai_api_key = key;

  try {
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      toast('Настройки ИИ сохранены', 'success');
      result.style.color = 'var(--success)';
      result.innerHTML = '<i class="fi fi-rr-check-circle"></i> Настройки успешно сохранены';
      document.getElementById('ai_api_key').value = '';
    } else { const d = await r.json(); toast(d.error || 'Ошибка сохранения', 'error'); }
  } catch { toast('Ошибка сети', 'error'); }
  finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить настройки ИИ';
    setTimeout(() => { result.textContent = ''; }, 5000);
  }
});

// -- Test SMTP --──────────────────────────────────────────────────────────────
document.getElementById('testEmailBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testEmailBtn');
  const result = document.getElementById('smtpResult');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Проверка...';

  try {
    const r = await fetch('/api/settings/test-email', { method: 'POST' });
    const d = await r.json();
    if (r.ok) { result.style.color = 'var(--success)'; result.innerHTML = `<i class="fi fi-rr-check-circle"></i> ${d.message}`; toast('Соединение успешно!', 'success'); }
    else { result.style.color = 'var(--danger)'; result.innerHTML = `<i class="fi fi-rr-cross-circle"></i> ${d.error}`; toast('Ошибка соединения', 'error'); }
  } catch { result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Ошибка запроса'; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fi fi-rr-plug"></i> Проверить соединение'; }
});

// ─── Change Password ────────────────────────────────────────────────────────
document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('savePasswordBtn');
  const result = document.getElementById('passwordResult');
  const currentPass = document.getElementById('current_password').value;
  const newPass = document.getElementById('new_password').value;
  const confirm = document.getElementById('confirm_password').value;

  if (!currentPass) { result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Введите текущий пароль'; return; }
  if (newPass.length < 8) { result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Пароль должен быть не менее 8 символов'; return; }
  if (newPass !== confirm) { result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Пароли не совпадают'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Сохранение...';

  try {
    const r = await fetch('/api/managers/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
    });
    if (r.ok) { result.style.color = 'var(--success)'; result.innerHTML = '<i class="fi fi-rr-check-circle"></i> Пароль успешно изменён'; toast('Пароль изменён', 'success'); document.getElementById('current_password').value = ''; document.getElementById('new_password').value = ''; document.getElementById('confirm_password').value = ''; }
    else { const d = await r.json(); result.style.color = 'var(--danger)'; result.innerHTML = `<i class="fi fi-rr-cross-circle"></i> ${d.error}`; }
  } catch { result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Ошибка соединения'; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fi fi-rr-key"></i> Сменить пароль'; setTimeout(() => { result.textContent = ''; }, 6000); }
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

const ROLE_LABELS = { admin: 'Администратор', scrum: 'Скрам-мастер', leader: 'Руководитель' };

function renderManagers(managers) {
  const list = document.getElementById('managerList');
  if (!list) return;
  if (!managers || managers.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Нет менеджеров</p>';
    return;
  }
  const isAdmin = currentManager?.role === 'admin';
  list.innerHTML = managers.map(m => `
    <div class="position-item">
      <div>
        <div style="font-weight:600;font-size:0.9rem;">${escHtml(m.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span>${escHtml(m.email)}</span>
          <span class="badge badge-accent" style="font-size:0.65rem;">${ROLE_LABELS[m.role] || m.role}</span>
          ${m.id === currentManager?.id ? '<span class="badge badge-accent" style="font-size:0.65rem;">Вы</span>' : ''}
        </div>
        ${isAdmin && m.id !== currentManager?.id ? `
        <div style="margin-top:6px;">
          <select class="form-control" style="font-size:0.78rem;padding:4px 8px;max-width:180px;" onchange="changeManagerRole(${m.id}, this.value)">
            <option value="admin" ${m.role==='admin'?'selected':''}>Администратор</option>
            <option value="scrum" ${m.role==='scrum'?'selected':''}>Скрам-мастер</option>
            <option value="leader" ${m.role==='leader'?'selected':''}>Руководитель</option>
          </select>
        </div>` : ''}
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
  const role = document.getElementById('newManagerRole')?.value || 'scrum';

  if (!name) { toast('Введите имя менеджера', 'warning'); return; }
  if (!login) { toast('Введите логин', 'warning'); return; }
  if (password.length < 8) { toast('Пароль должен быть не менее 8 символов', 'warning'); return; }

  try {
    const r = await fetch('/api/managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, login, password, role }),
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
    if (d.custom) el.innerHTML = '<span style="color:var(--success)"><i class="fi fi-rr-check-circle"></i> Пользовательский шаблон загружен</span>';
    else el.innerHTML = '<span style="color:var(--text-muted)"><i class="fi fi-rr-document"></i> Используется базовый шаблон</span>';
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
    if (r.ok) { result.innerHTML = '<i class="fi fi-rr-check-circle"></i> Шаблон загружен'; result.style.color = 'var(--success)'; toast('Шаблон загружен', 'success'); loadTemplateInfo(); }
    else { result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> ' + (d.error || 'Ошибка'); result.style.color = 'var(--danger)'; }
  } catch { result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Ошибка соединения'; result.style.color = 'var(--danger)'; }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fi fi-rr-upload"></i> Загрузить шаблон'; setTimeout(() => { result.textContent = ''; }, 5000); }
});

// ─── Import Excel ────────────────────────────────────────────────────────────
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!confirm('Импорт обновит существующих сотрудников (сравнивая по email) и добавит новых.\nПродолжить?')) {
    e.target.value = '';
    return;
  }

  const result = document.getElementById('importResult');
  result.innerHTML = '<span class="spinner"></span> Импорт...';

  const fd = new FormData();
  fd.append('file', file);
  fd.append('mode', 'add');

  try {
    const r = await fetch('/api/excel/import', { method: 'POST', body: fd });
    const d = await r.json();
    e.target.value = '';
    if (r.ok) {
      result.innerHTML = '<span style="color:var(--success)"><i class="fi fi-rr-check-circle"></i> Импорт завершён</span>';
      toast(`Импорт завершён: добавлено ${d.imported}, обновлено ${d.updated}`, 'success');
    } else {
      result.innerHTML = '<span style="color:var(--danger)"><i class="fi fi-rr-cross-circle"></i> ' + (d.error || 'Ошибка импорта') + '</span>';
      toast(d.error || 'Ошибка импорта', 'error');
    }
  } catch {
    result.innerHTML = '<span style="color:var(--danger)"><i class="fi fi-rr-cross-circle"></i> Ошибка при импорте файла</span>';
    toast('Ошибка при импорте файла', 'error');
  }
  setTimeout(() => { result.innerHTML = ''; }, 5000);
});

// ─── Init ────────────────────────────────────────────────────────────────────
(async () => {
  const auth = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ authenticated: false }));
  if (!auth.authenticated) { location.href = '/login.html'; return; }
  currentManager = auth.manager;
  document.getElementById('currentManagerLogin').textContent = currentManager?.email || '';

  initTheme();
  applyRoleUI(currentManager?.role);
  await Promise.all([loadSettings(), loadPositions(), loadManagers(), loadTemplateInfo(), loadPositionCompetencies(), loadPositionAliases(), loadFeedback()]);
})();

function applyRoleUI(role) {
  document.querySelectorAll('[data-role]').forEach(el => {
    const allowed = el.getAttribute('data-role').split(',').map(r => r.trim());
    if (role === 'admin') { el.style.display = ''; return; } // admin sees everything
    if (allowed.includes(role)) { el.style.display = ''; return; }
    // scrum: sees cards marked data-role="scrum"; leader: sees nothing marked
    el.style.display = 'none';
  });
  // leader also hides positions, import, template, managers management
  if (role === 'leader') {
    document.querySelectorAll('.collapsible').forEach(c => c.style.display = 'none');
  }
  // scrum: hide positions card, import, template, managers
  if (role === 'scrum') {
    document.querySelectorAll('.collapsible').forEach(c => {
      const title = c.querySelector('.card-title')?.textContent || '';
      if (title.includes('Должности') || title.includes('Аналоги') || title.includes('Обратная') || title.includes('Шаблон') || title.includes('менеджер') || title.includes('Импорт')) {
        c.style.display = 'none';
      }
    });
    // load scrum email
    loadScrumEmail();
  }
}

// ─── Scrum email save ─────────────────────────────────────────────────────
async function loadScrumEmail() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    document.getElementById('scrum_manager_email').value = s.manager_email || '';
  } catch {}
}

const scrumEmailForm = document.getElementById('scrumEmailForm');
if (scrumEmailForm) {
  scrumEmailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveScrumEmailBtn');
    const result = document.getElementById('scrumEmailResult');
    btn.disabled = true;
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_email: document.getElementById('scrum_manager_email').value.trim() }),
      });
      if (r.ok) { result.style.color = 'var(--success)'; result.innerHTML = '<i class="fi fi-rr-check-circle"></i> Сохранено'; toast('Email сохранён', 'success'); }
      else { const d = await r.json(); result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> ' + (d.error || 'Ошибка'); }
    } catch { result.style.color = 'var(--danger)'; result.innerHTML = '<i class="fi fi-rr-cross-circle"></i> Ошибка соединения'; }
    finally { btn.disabled = false; btn.textContent = 'Сохранить'; setTimeout(() => { result.textContent = ''; }, 5000); }
  });
}

// ─── Role change on manager list ────────────────────────────────────────────
async function changeManagerRole(id, newRole) {
  try {
    const r = await fetch(`/api/managers/${id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    if (r.ok) { toast('Роль обновлена', 'success'); await loadManagers(); }
    else { const d = await r.json(); toast(d.error || 'Ошибка', 'error'); }
  } catch { toast('Ошибка соединения', 'error'); }
}
