require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const { Store } = require('express-session');
const { sessions, initPromise } = require('./db');

// ─── PostgreSQL Session Store ──────────────────────────────────────────────────
class PgStore extends Store {
  get(sid, cb) {
    sessions.get(sid)
      .then(row => {
        if (!row) return cb(null, null);
        cb(null, JSON.parse(row.sess));
      })
      .catch(e => cb(e));
  }
  set(sid, session, cb) {
    const maxAge = session.cookie && session.cookie.maxAge
      ? session.cookie.maxAge : 8 * 60 * 60 * 1000;
    sessions.set(sid, session, maxAge)
      .then(() => cb(null))
      .catch(e => cb(e));
  }
  destroy(sid, cb) {
    sessions.destroy(sid)
      .then(() => { if (cb) cb(null); })
      .catch(e => { if (cb) cb(e); });
  }
  touch(sid, session, cb) {
    const maxAge = session.cookie && session.cookie.maxAge
      ? session.cookie.maxAge : 8 * 60 * 60 * 1000;
    sessions.touch(sid, maxAge)
      .then(() => cb(null))
      .catch(e => cb(e));
  }
}

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

// ─── Защита страниц менеджера ─────────────────────────────────────────────────
const PROTECTED_PAGES = ['/index.html', '/review.html', '/settings.html'];
app.use((req, res, next) => {
  if (PROTECTED_PAGES.includes(req.path) && !req.session.isManager) {
    return res.redirect('/login.html');
  }
  next();
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  if (req.session.isManager) return res.redirect('/index.html');
  res.redirect('/login.html');
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api',         require('./routes/manager'));
app.use('/api/form',    require('./routes/employee'));
app.use('/api/excel',   require('./routes/excel'));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// ─── Запуск после инициализации БД ────────────────────────────────────────────
initPromise.then(() => {
  app.listen(config.port, config.host, () => {
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
}).catch(err => {
  console.error('❌ Не удалось инициализировать БД:', err.message);
  process.exit(1);
});

module.exports = app;
