const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { helpers } = require('../db');
const config = require('../config');
const { authenticateAD } = require('../auth/adAuth');

// ─── Устанавливает сессию и отвечает клиенту ───────────────────────────────
function setManagerSession(req, res, manager) {
  req.session.isManager = true;
  req.session.managerId = manager.id;
  req.session.managerName = manager.name;
  req.session.managerLogin = manager.email;
  req.session.managerRole = manager.role || 'leader';
  res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email, role: manager.role || 'leader' } });
}

router.post('/login', async (req, res, next) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    // ── Шаг 1: если включена интеграция с AD — пробуем через неё ──────────
    if (config.ad.enabled) {
      try {
        const adResult = await authenticateAD(login, password);

        // Ищем локальную запись менеджера (для id, отображаемого имени и т.д.)
        let manager = await helpers.getManagerByLogin(login);

        if (!manager) {
          // Первый вход через AD — заводим локальную запись автоматически.
          // Пароль реальный не хранится (роль пароля выполняет AD), поэтому
          // пишем случайный хеш-заглушку — локальный bcrypt-вход для этого
          // пользователя не будет работать, что и требуется: пароль — только в AD.
          const randomPlaceholder = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 10);
          manager = await helpers.createManager(login, login, randomPlaceholder, adResult.role);
        } else if (manager.role !== adResult.role) {
          // Синхронизируем роль, если членство в группе AD изменилось
          await helpers.updateManagerRole(manager.id, adResult.role);
          manager.role = adResult.role;
        }

        return setManagerSession(req, res, manager);
      } catch (adError) {
        console.log('AD-авторизация не удалась, пробуем локальную базу:', adError.message);
        // Падаем в локальную проверку ниже, а не отказываем сразу —
        // это и есть требуемый fallback на случай недоступности AD.
      }
    }

    // ── Шаг 2: локальная проверка (существующая логика, без изменений) ────
    const manager = await helpers.getManagerByLogin(login);
    if (!manager || !bcrypt.compareSync(password, manager.password_hash)) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    setManagerSession(req, res, manager);
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => { res.json({ ok: true }); });
});

router.get('/me', (req, res) => {
  res.json({
    authenticated: !!req.session.isManager,
    manager: req.session.isManager ? {
      id: req.session.managerId,
      name: req.session.managerName,
      email: req.session.managerLogin,
      role: req.session.managerRole || 'leader',
    } : null,
  });
});

module.exports = router;
