const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { helpers } = require('../db');
const { generateResume } = require('../wordgen');
const { notifyEmployeeApproved, notifyEmployeeRejected, testConnection } = require('../mailer');

function requireAuth(req, res, next) {
  if (!req.session.isManager) return res.status(401).json({ error: 'Требуется авторизация' });
  next();
}

// ── Список сотрудников ────────────────────────────────────────────────────────
router.get('/employees', requireAuth, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const list = helpers.getAllEmployees().map(e => ({
    ...e,
    link: `${base}/form.html?token=${e.token}`,
  }));
  res.json(list);
});

// ── Один сотрудник ────────────────────────────────────────────────────────────
router.get('/employees/:id', requireAuth, (req, res) => {
  const emp = helpers.getEmployee(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    ...emp,
    pendingChanges: helpers.getPendingByEmployee(emp.id),
    link: `${base}/form.html?token=${emp.token}`,
  });
});

// ── Прямое редактирование менеджером ─────────────────────────────────────────
router.put('/employees/:id', requireAuth, (req, res) => {
  const updated = helpers.updateEmployee(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, employee: updated });
});

// ── Архивировать / восстановить сотрудника ───────────────────────────────────
router.delete('/employees/:id', requireAuth, (req, res) => {
  const ok = helpers.archiveEmployee(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, status: 'archived' });
});
router.post('/employees/:id/restore', requireAuth, (req, res) => {
  const ok = helpers.restoreEmployee(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ ok: true, status: 'active' });
});

// ── Новый токен ───────────────────────────────────────────────────────────────
router.post('/employees/:id/new-token', requireAuth, (req, res) => {
  const emp = helpers.regenerateToken(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ token: emp.token, link: `${base}/form.html?token=${emp.token}`, employee: emp });
});

// ── Все ожидающие изменения ───────────────────────────────────────────────────
router.get('/pending', requireAuth, (req, res) => {
  res.json(helpers.getPendingGrouped());
});

// ── Подтвердить одно изменение ────────────────────────────────────────────────
router.post('/pending/:changeId/approve', requireAuth, async (req, res) => {
  const ok = helpers.approveChange(Number(req.params.changeId), req.session.managerName || '');
  if (!ok) return res.status(404).json({ error: 'Изменение не найдено' });
  res.json({ ok: true });
});

// ── Отклонить одно изменение ──────────────────────────────────────────────────
router.post('/pending/:changeId/reject', requireAuth, (req, res) => {
  const ok = helpers.rejectChange(Number(req.params.changeId), req.body.reason || '', req.session.managerName || '');
  if (!ok) return res.status(404).json({ error: 'Изменение не найдено' });
  res.json({ ok: true });
});

// ── Подтвердить все изменения сотрудника ─────────────────────────────────────
router.post('/employees/:id/approve-all', requireAuth, async (req, res) => {
  const id  = Number(req.params.id);
  const emp = helpers.getEmployee(id);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
  const applied = helpers.approveAllForEmployee(id, req.session.managerName || '');
  notifyEmployeeApproved(emp).catch(() => {});
  res.json({ ok: true, applied });
});

// ── Отклонить все изменения сотрудника ───────────────────────────────────────
router.post('/employees/:id/reject-all', requireAuth, async (req, res) => {
  const id  = Number(req.params.id);
  const emp = helpers.getEmployee(id);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найдена' });
  helpers.rejectAllForEmployee(id, req.body.reason || '', req.session.managerName || '');
  notifyEmployeeRejected(emp, req.body.reason).catch(() => {});
  res.json({ ok: true });
});

// ── Создать сотрудника ──────────────────────────────────────────────────────
router.post('/employees', requireAuth, (req, res) => {
  const emp = helpers.createEmployee(req.body);
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ ok: true, employee: { ...emp, link: `${base}/form.html?token=${emp.token}` } });
});

// ── Должности: список ────────────────────────────────────────────────────────
router.get('/positions', requireAuth, (req, res) => {
  res.json({ positions: helpers.getPositions() });
});

// ── Должности: добавить ──────────────────────────────────────────────────────
router.post('/positions', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Название должности обязательно' });
  const positions = helpers.addPosition(name.trim());
  res.json({ ok: true, positions });
});

// ── Должности: удалить ──────────────────────────────────────────────────────
router.delete('/positions/:name', requireAuth, (req, res) => {
  const positions = helpers.removePosition(decodeURIComponent(req.params.name));
  res.json({ ok: true, positions });
});
router.get('/employees/:id/resume', requireAuth, async (req, res) => {
  const emp = helpers.getEmployee(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  try {
    const buf = await generateResume(emp);
    const fn  = `resume_${emp.name.replace(/\s+/g, '_')}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка генерации резюме' });
  }
});

// ── Настройки: получить ───────────────────────────────────────────────────────
router.get('/settings', requireAuth, (req, res) => {
  const keys = ['smtp_host','smtp_port','smtp_user','smtp_from','manager_email', 'positions'];
  const out  = {};
  for (const k of keys) out[k] = helpers.getSetting(k);
  // positions is already an array from loadSettings
  try { out.positions = JSON.parse(out.positions || '[]'); } catch { out.positions = []; }
  res.json(out);
});

// ── Настройки: сохранить ─────────────────────────────────────────────────────
router.put('/settings', requireAuth, (req, res) => {
  const allowed = ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','manager_email'];
  for (const k of allowed) if (req.body[k] !== undefined) helpers.setSetting(k, req.body[k]);
  res.json({ ok: true });
});

// ── Тест SMTP ────────────────────────────────────────────────────────────────
router.post('/settings/test-email', requireAuth, async (req, res) => {
  try {
    await testConnection();
    res.json({ ok: true, message: 'Соединение успешно' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Статистика ────────────────────────────────────────────────────────────────
router.get('/stats', requireAuth, (req, res) => {
  res.json(helpers.getStats());
});

// ── Менеджеры: список ─────────────────────────────────────────────────────────
router.get('/managers', requireAuth, (req, res) => {
  res.json({ managers: helpers.getAllManagers() });
});

// ── Менеджеры: создать ────────────────────────────────────────────────────────
router.post('/managers', requireAuth, (req, res) => {
  const { name, login, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Имя обязательно' });
  if (!login || !login.trim()) return res.status(400).json({ error: 'Логин обязателен' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
  try {
    const hash = require('bcryptjs').hashSync(password, 10);
    const manager = helpers.createManager(name.trim(), login.trim(), hash);
    res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Менеджеры: удалить ────────────────────────────────────────────────────────
router.delete('/managers/:id', requireAuth, (req, res) => {
  try {
    helpers.deleteManager(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Менеджеры: сменить свой пароль ────────────────────────────────────────────
router.put('/managers/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Все поля обязательны' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });

  const manager = helpers.getManagerById(req.session.managerId);
  if (!manager) return res.status(404).json({ error: 'Менеджер не найден' });

  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(currentPassword, manager.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  helpers.updateManagerPassword(manager.id, hash);
  res.json({ ok: true });
});

module.exports = router;
