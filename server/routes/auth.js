const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { helpers } = require('../db');
const config = require('../config');
const { authenticateAD } = require('../auth/adAuth');

// ─── Устанавливает сессию и отвечает клиенту ───────────────────────────────
function setManagerSession(req, res, manager) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.isManager = true;
      req.session.managerId = manager.id;
      req.session.managerName = manager.name;
      req.session.managerEmail = manager.email;
      req.session.managerLogin = manager.email;
      req.session.managerRole = manager.role || 'leader';
      req.session.save((saveError) => {
        if (saveError) return reject(saveError);
        res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email, role: manager.role || 'leader' } });
        resolve();
      });
    });
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

async function findManagerByEmailOrLegacyLogin(email) {
  let manager = await helpers.getManagerByLogin(email);
  if (!manager) {
    const legacyLogin = email.split('@')[0];
    manager = await helpers.getManagerByLogin(legacyLogin);
  }
  return manager;
}

async function migrateManagerEmail(manager, email) {
  if (manager.email === email) return manager;
  await helpers.updateManagerEmail(manager.id, email);
  return { ...manager, email };
}

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email || req.body.login);
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Почта и пароль обязательны' });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: 'Введите корректный адрес электронной почты' });
    }

    // ── Шаг 1: если включена интеграция с AD — пробуем через неё ──────────
    if (config.ad.enabled) {
      try {
        const adResult = await authenticateAD(email, password);

        // Ищем локальную запись менеджера (для id, отображаемого имени и т.д.)
        let manager = await findManagerByEmailOrLegacyLogin(email);

        if (!manager) {
          // Первый вход через AD — заводим локальную запись автоматически.
          // Пароль реальный не хранится (роль пароля выполняет AD), поэтому
          // пишем случайный хеш-заглушку — локальный bcrypt-вход для этого
          // пользователя не будет работать, что и требуется: пароль — только в AD.
          const randomPlaceholder = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 10);
          manager = await helpers.createManager(adResult.username, email, randomPlaceholder, adResult.role);
        } else {
          manager = await migrateManagerEmail(manager, email);
        }
        if (manager.role !== adResult.role) {
          // Синхронизируем роль, если членство в группе AD изменилось
          await helpers.updateManagerRole(manager.id, adResult.role);
          manager.role = adResult.role;
        }

        return await setManagerSession(req, res, manager);
      } catch (adError) {
        console.warn('AD-авторизация не удалась:', adError.message);
        if (!config.ad.allowLocalFallback) {
          return res.status(401).json({ error: 'Неверная почта или пароль' });
        }
      }
    }

    // ── Шаг 2: локальная проверка (существующая логика, без изменений) ────
    let manager = await findManagerByEmailOrLegacyLogin(email);
    if (!manager || !bcrypt.compareSync(password, manager.password_hash)) {
      return res.status(401).json({ error: 'Неверная почта или пароль' });
    }
    manager = await migrateManagerEmail(manager, email);
    await setManagerSession(req, res, manager);
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
      email: req.session.managerEmail || req.session.managerLogin,
      role: req.session.managerRole || 'leader',
    } : null,
  });
});

module.exports = router;
