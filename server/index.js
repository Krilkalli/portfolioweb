require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,       // true при HTTPS
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 часов
  },
}));

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Защита страниц менеджера ─────────────────────────────────────────────────
const PROTECTED_PAGES = ['/index.html', '/review.html', '/settings.html'];
app.use((req, res, next) => {
  if (PROTECTED_PAGES.includes(req.path) && !req.session.isManager) {
    return res.redirect('/login.html');
  }
  next();
});

// Корень → редирект
app.get('/', (req, res) => {
  if (req.session.isManager) return res.redirect('/index.html');
  res.redirect('/login.html');
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api',         require('./routes/manager'));   // /api/employees, /api/pending, /api/settings, /api/stats
app.use('/api/form',    require('./routes/employee'));
app.use('/api/excel',   require('./routes/excel'));

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   Портфолио IS1C — сервер запущен        ║
  ║   http://localhost:${config.port}                  ║
  ║                                          ║
  ║   Логин менеджера: /login.html           ║
  ║   Пароль по умолчанию: Admin1234!        ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
