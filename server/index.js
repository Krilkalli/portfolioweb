require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const https = require('https');
const config = require('./config');
const { Store } = require('express-session');
const { sessions, initPromise } = require('./db');
const { securityHeaders, createRateLimiter, csrfProtection } = require('./security');

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
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 200 }));

app.use('/api/auth/login', createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Слишком много попыток входа. Повторите через 15 минут.',
}));
app.use('/api/form/correct-text', createRateLimiter({ windowMs: 5 * 60 * 1000, max: 15 }));
app.use('/api/ai', createRateLimiter({ windowMs: 5 * 60 * 1000, max: 30 }));
app.use('/api/form', createRateLimiter({ windowMs: 5 * 60 * 1000, max: 180 }));
app.use('/api', createRateLimiter({ windowMs: 5 * 60 * 1000, max: 600 }));

app.use(session({
  name: 'portfolio.sid',
  store: new PgStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.secureCookies,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));
app.use('/api', csrfProtection);

// ─── Защита страниц менеджера ─────────────────────────────────────────────────
const PROTECTED_PAGES = ['/index.html', '/review.html', '/history.html', '/settings.html'];
const PROJECT_PAGES = ['/projects.html', '/project.html'];
app.use((req, res, next) => {
  if (req.path === '/myprojects.html') {
    if (!req.session.isManager) return res.redirect('/login.html');
    return res.redirect(req.session.managerRole === 'leader' ? '/projects.html' : '/index.html');
  }
  if (PROTECTED_PAGES.includes(req.path) && !req.session.isManager) {
    return res.redirect('/login.html');
  }
  if (req.path === '/index.html' && req.session.isManager && req.session.managerRole === 'leader') {
    return res.redirect('/projects.html');
  }
  if (PROJECT_PAGES.includes(req.path)) {
    if (!req.session.isManager) return res.redirect('/login.html');
    if (!['admin', 'leader'].includes(req.session.managerRole)) return res.redirect('/index.html');
  }
  next();
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  if (req.session.isManager) return res.redirect(req.session.managerRole === 'leader' ? '/projects.html' : '/index.html');
  res.redirect('/login.html');
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api',         require('./routes/manager'));
app.use('/api/form',    require('./routes/employee'));
app.use('/api/excel',   require('./routes/excel'));
app.use('/api/ai',      require('./routes/ai'));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err?.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Файл превышает допустимый размер'
      : 'Недопустимый файл или превышено ограничение загрузки';
    return res.status(400).json({ error: message });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// ─── Запуск после инициализации БД ────────────────────────────────────────────
initPromise.then(() => {
  const hasTls = Boolean(config.tls.keyPath && config.tls.certPath);
  const server = hasTls
    ? https.createServer({
        key: fs.readFileSync(config.tls.keyPath),
        cert: fs.readFileSync(config.tls.certPath),
      }, app)
    : app;
  server.listen(config.port, config.host, () => {
    const protocol = hasTls ? 'https' : 'http';
    console.log(`
  ╔══════════════════════════════════════════╗
  ║   Портфолио IS1C — сервер запущен        ║
  ║   ${protocol}://localhost:${config.port}                  ║
  ║                                          ║
  ║   Вход менеджера: /login.html            ║
  ╚══════════════════════════════════════════╝
    `);
    if (!hasTls && process.env.NODE_ENV === 'production') {
      console.warn('⚠️  HTTP без шифрования: настройте корпоративный HTTPS reverse proxy или TLS_CERT_PATH/TLS_KEY_PATH.');
    }
  });
}).catch(err => {
  console.error('❌ Не удалось инициализировать БД:', err.message);
  process.exit(1);
});

module.exports = app;
