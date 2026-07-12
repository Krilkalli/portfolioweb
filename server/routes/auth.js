const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { helpers } = require('../db');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }
  const manager = helpers.getManagerByLogin(login);
  if (!manager || !bcrypt.compareSync(password, manager.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  req.session.isManager = true;
  req.session.managerId = manager.id;
  req.session.managerName = manager.name;
  req.session.managerLogin = manager.email;
  req.session.managerRole = manager.role || 'admin';
  res.json({ ok: true, manager: { id: manager.id, name: manager.name, email: manager.email, role: manager.role || 'admin' } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => { res.json({ ok: true }); });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  res.json({
    authenticated: !!req.session.isManager,
    manager: req.session.isManager ? {
      id: req.session.managerId,
      name: req.session.managerName,
      email: req.session.managerLogin,
      role: req.session.managerRole || 'admin',
    } : null,
  });
});

module.exports = router;
