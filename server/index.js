require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const Database = require('better-sqlite3');
const { Store } = require('express-session');

// ─── SQLite Session Store ─────────────────────────────────────────────────────
const SESSION_DB_PATH = path.join(__dirname, '..', 'data', 'sessions.db');
const sessionDb = new Database(SESSION_DB_PATH);
sessionDb.pragma('journal_mode = WAL');
sessionDb.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    expired REAL NOT NULL,
    sess TEXT NOT NULL
  )
`);
const stGetSession = sessionDb.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
const stUpsertSession = sessionDb.prepare(
  'INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)'
);
const stDelSession = sessionDb.prepare('DELETE FROM sessions WHERE sid = ?');
const stTouchSession = sessionDb.prepare('UPDATE sessions SET expired = ? WHERE sid = ?');
const stCleanExpired = sessionDb.prepare('DELETE FROM sessions WHERE expired <= ?');

class SqliteStore extends Store {
  get(sid, cb) {
    try {
      const row = stGetSession.get(sid, Date.now());
      if (!row) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, session, cb) {
    try {
      const maxAge = session.cookie && session.cookie.maxAge
        ? session.cookie.maxAge : 8 * 60 * 60 * 1000;
      stUpsertSession.run(sid, Date.now() + maxAge, JSON.stringify(session));
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { stDelSession.run(sid); if (cb) cb(null); } catch (e) { if (cb) cb(e); }
  }
  touch(sid, session, cb) {
    try {
      const maxAge = session.cookie && session.cookie.maxAge
        ? session.cookie.maxAge : 8 * 60 * 60 * 1000;
      stTouchSession.run(Date.now() + maxAge, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}
// Clean expired sessions every 15 minutes
setInterval(() => { try { stCleanExpired.run(Date.now()); } catch {} }, 15 * 60 * 1000);

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SqliteStore(),
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

module.exports = app;
