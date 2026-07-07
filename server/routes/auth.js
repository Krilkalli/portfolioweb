const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { helpers } = require('../db');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const hash = helpers.getSetting('manager_password_hash');
  if (!hash || !bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  req.session.isManager = true;
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  res.json({ authenticated: !!req.session.isManager });
});

module.exports = router;
