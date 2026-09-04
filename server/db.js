const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { composeProjectDescription } = require('./projectDescription');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const config = require('./config');
const { normalizeForComparison } = require('./changeComparison');

const SECRET_SETTING_KEYS = new Set(['smtp_pass', 'ai_api_key']);
const settingsEncryptionKey = crypto.createHash('sha256').update(config.sessionSecret).digest();

function encryptSetting(key, value) {
  const plain = String(value ?? '');
  if (!SECRET_SETTING_KEYS.has(key) || !plain || plain.startsWith('enc:v1:')) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', settingsEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSetting(key, value) {
  const stored = String(value ?? '');
  if (!SECRET_SETTING_KEYS.has(key) || !stored.startsWith('enc:v1:')) return stored;
  try {
    const [, , iv, tag, encrypted] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', settingsEncryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

const pool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
});

pool.on('error', err => console.error('PG pool error:', err.message));

// ─── Query helpers (supports both array and @named params) ────────────────────
function _query(sql, params) {
  if (params && !Array.isArray(params)) {
    let idx = 0;
    const values = [];
    const converted = sql.replace(/@(\w+)/g, (_, key) => {
      values.push(params[key]);
      return `$${++idx}`;
    });
    return pool.query(converted, values);
  }
  return pool.query(sql, params);
}

function _get(sql, ...params) {
  return _query(sql, ...params).then(r => r.rows[0] || null);
}

function _all(sql, ...params) {
  return _query(sql, ...params).then(r => r.rows);
}

function _run(sql, ...params) {
  return _query(sql, ...params);
}

// ─── Schema ──────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL DEFAULT '',
    education TEXT DEFAULT '[]',
    position TEXT DEFAULT '',
    contacts TEXT DEFAULT '',
    experience TEXT DEFAULT '{}',
    about TEXT DEFAULT '',
    competencies TEXT DEFAULT '',
    project_experience TEXT DEFAULT '[]',
    certification TEXT DEFAULT '',
    email TEXT DEFAULT '',
    city TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    photo TEXT DEFAULT '',
    is_rp BOOLEAN NOT NULL DEFAULT FALSE,
    token TEXT,
    token_expires_at TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_changes (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    submitted_at TEXT,
    status TEXT DEFAULT 'pending',
    reviewed_at TEXT DEFAULT '',
    reviewed_by TEXT DEFAULT '',
    reject_reason TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS approval_history (
    id SERIAL PRIMARY KEY,
    source_change_id INTEGER NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    employee_name TEXT DEFAULT '',
    employee_position TEXT DEFAULT '',
    field_name TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    submitted_at TEXT DEFAULT '',
    reviewed_at TEXT DEFAULT '',
    reviewed_by TEXT DEFAULT '',
    decision_status TEXT NOT NULL DEFAULT 'approved',
    reject_reason TEXT DEFAULT '',
    reverted_at TEXT DEFAULT '',
    reverted_by TEXT DEFAULT '',
    returned_to_pending_at TEXT DEFAULT '',
    returned_to_pending_by TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS employee_feedback (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    rating INTEGER,
    comment TEXT DEFAULT '',
    submitted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS managers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT,
    role TEXT DEFAULT 'admin',
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Черновик',
    customer TEXT DEFAULT '',
    code_name TEXT DEFAULT '',
    legal_customer_name TEXT DEFAULT '',
    industry_description TEXT DEFAULT '',
    description TEXT DEFAULT '',
    start_period TEXT DEFAULT '',
    end_period TEXT DEFAULT '',
    end_present BOOLEAN NOT NULL DEFAULT FALSE,
    team_size INTEGER DEFAULT 0,
    technologies TEXT DEFAULT '',
    functional_area TEXT DEFAULT '',
    functional_blocks TEXT DEFAULT '[]',
    team_members TEXT DEFAULT '[]',
    leader_id INTEGER REFERENCES managers(id) ON DELETE SET NULL,
    leader_name TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT,
    sent_at TEXT DEFAULT '',
    source_system TEXT DEFAULT '',
    source_data TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    expired REAL NOT NULL,
    sess TEXT NOT NULL
  );
`;

// ─── Нормализация имени для поиска дубликатов ──────────────────────────────
function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findEmployeeProfileForLeader(client, name, email, excludeManagerId = null) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) throw new Error('Для роли РП укажите ФИО сотрудника');

  const matches = await client.query(
    'SELECT id, name, email, status FROM employees WHERE name_lower = $1 ORDER BY id',
    [normalizedName]
  );
  if (!matches.rows.length) {
    throw new Error(`Сотрудник «${String(name || '').trim()}» не найден. Укажите ФИО точно как в профиле сотрудника`);
  }

  const activeMatches = matches.rows.filter(employee => employee.status !== 'archived');
  if (!activeMatches.length) throw new Error('Найденный профиль сотрудника находится в архиве');

  let employee = activeMatches[0];
  if (activeMatches.length > 1) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const emailMatches = activeMatches.filter(item => String(item.email || '').trim().toLowerCase() === normalizedEmail);
    if (emailMatches.length !== 1) {
      throw new Error('Найдено несколько сотрудников с таким ФИО. Укажите email, совпадающий с профилем сотрудника');
    }
    [employee] = emailMatches;
  }

  const linkedManager = await client.query(
    `SELECT id, name, email
     FROM managers
     WHERE employee_id = $1 AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [employee.id, excludeManagerId ? Number(excludeManagerId) : null]
  );
  if (linkedManager.rows[0]) {
    throw new Error(`Профиль сотрудника уже связан с учётной записью «${linkedManager.rows[0].name}»`);
  }

  return employee;
}

// ─── Безопасные поля для динамического UPDATE ────────────────────────────────
const ALLOWED_FIELDS = new Set([
  'name','education','position','contacts','experience','about','competencies',
  'project_experience','certification','email','city','phone','photo',
]);

const FIELD_LABELS = {
  name: 'ФИО',
  education: 'Образование',
  position: 'Должность',
  contacts: 'Контактные данные',
  experience: 'Стаж работы',
  total_experience: 'Общий стаж',
  about: 'Обо мне',
  competencies: 'Компетенции',
  project_experience: 'Проектный опыт',
  certification: 'Сертификация 1С',
  email: 'Email',
  city: 'Город',
  phone: 'Телефон',
  photo: 'Фото',
};

// ─── Парсинг legacy-текста образования в JSON-массив ──────────────────────
function parseLegacyEducationLines(val) {
  const text = String(val || '').trim();
  if (!text) return [];
  if (text.includes(';') || text.includes(',\n') === false) {
    const entries = text.split(';').filter(e => e.trim());
    if (entries.some(e => e.split(',').length >= 2)) {
      return entries.map(e => {
        const parts = e.split(',');
        return {
          institution: parts[0]?.trim() || '',
          degree: parts[1]?.trim() || '',
          specialty: parts[2]?.trim() || '',
          year: parts[3]?.trim() || '',
        };
      }).filter(e => e.institution);
    }
  }
  const blocks = text.split(/\n\s*\n/);
  return blocks.filter(b => b.trim()).map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    return {
      institution: lines[0]?.replace(/[,\s]+$/, '') || '',
      degree: lines.length > 1 ? lines[1].replace(/[,\s]+$/, '') : '',
      specialty: lines.length > 2 ? lines[2].replace(/[,\s]+$/, '') : '',
      year: lines.length > 3 ? lines[3].replace(/[,;]\s*$/, '') : '',
    };
  });
}

// ─── castEmployee – парсинг JSON-полей ──────────────────────────────────────
function castEmployee(r) {
  if (!r) return null;
  const emp = { ...r };
  emp.id = Number(emp.id);
  try { emp.education = JSON.parse(emp.education || '[]'); } catch { emp.education = parseLegacyEducationLines(emp.education); }
  try { emp.experience = JSON.parse(emp.experience || '{}'); } catch { emp.experience = parseLegacyExperience(emp.experience); }
  try { emp.project_experience = JSON.parse(emp.project_experience || '[]'); } catch { emp.project_experience = parseLegacyProject(emp.project_experience); }
  delete emp.name_lower;
  return emp;
}

function castEmployees(rows) { return rows.map(castEmployee); }

function castProject(row) {
  if (!row) return null;
  const project = { ...row, id: Number(row.id) };
  try { project.team_members = JSON.parse(project.team_members || '[]'); } catch { project.team_members = []; }
  try { project.functional_blocks = JSON.parse(project.functional_blocks || '[]'); } catch { project.functional_blocks = []; }
  try { project.source_data = JSON.parse(project.source_data || '[]'); } catch { project.source_data = []; }
  return project;
}

function castProjects(rows) { return rows.map(castProject); }

async function withActiveProjectMembers(projects) {
  const single = !Array.isArray(projects);
  const list = (single ? [projects] : projects).filter(Boolean);
  const memberIds = [...new Set(list.flatMap(project =>
    (project.team_members || []).map(member => Number(member.employee_id)).filter(Boolean)
  ))];
  if (memberIds.length === 0) return single ? (list[0] || null) : list;

  const activeRows = await _all(
    "SELECT id, name FROM employees WHERE id = ANY($1::int[]) AND status = 'active'",
    [memberIds]
  );
  const activeNames = new Map(activeRows.map(employee => [Number(employee.id), employee.name]));
  const filtered = list.map(project => ({
    ...project,
    team_members: (project.team_members || [])
      .filter(member => activeNames.has(Number(member.employee_id)))
      .map(member => ({ ...member, name: activeNames.get(Number(member.employee_id)) }))
  }));
  return single ? (filtered[0] || null) : filtered;
}

function formatProjectPeriod(project) {
  return [
    project?.start_period || '',
    project?.end_present ? 'настоящее время' : (project?.end_period || ''),
  ].filter(Boolean).join(' - ');
}

async function withProjectDateChecks(projects) {
  const single = !Array.isArray(projects);
  const list = (single ? [projects] : projects).filter(Boolean);
  const memberIds = [...new Set(list.flatMap(project =>
    (project.team_members || []).map(member => Number(member.employee_id || member.id || 0)).filter(Boolean)
  ))];
  const employeeRows = memberIds.length
    ? await _all('SELECT id, name, project_experience FROM employees WHERE id = ANY($1::int[])', [memberIds])
    : [];
  const employees = new Map(employeeRows.map(employee => {
    let experience = [];
    try { experience = JSON.parse(employee.project_experience || '[]'); } catch { experience = parseLegacyProject(employee.project_experience); }
    return [Number(employee.id), { ...employee, experience: Array.isArray(experience) ? experience : [] }];
  }));

  const checked = list.map(project => {
    const projectPeriod = formatProjectPeriod(project);
    const members = (project.team_members || []).map(member => {
      const employeeId = Number(member.employee_id || member.id || 0);
      const employee = employees.get(employeeId);
      const saved = employee?.experience.find(item => Number(item?.project_id || 0) === Number(project.id));
      const period = String(saved?.period || '').trim();
      const individual = Boolean(saved?.period_overridden) || Boolean(period && period !== projectPeriod);
      return {
        employee_id: employeeId,
        employee_name: employee?.name || member.employee_name || member.name || '',
        period,
        status: !period ? 'missing' : (individual ? 'individual' : 'matches'),
      };
    }).filter(member => member.employee_id);
    return {
      ...project,
      date_check: {
        total: members.length,
        matching: members.filter(member => member.status === 'matches').length,
        individual: members.filter(member => member.status === 'individual').length,
        missing: members.filter(member => member.status === 'missing').length,
        project_period: projectPeriod,
        members,
      },
    };
  });
  return single ? (checked[0] || null) : checked;
}

// ─── JSON-сериализация для записи ──────────────────────────────────────────
function prepEmployee(emp) {
  const now = new Date().toISOString();
  return {
    name: emp.name || '',
    name_lower: normalizeName(emp.name),
    education: Array.isArray(emp.education) ? JSON.stringify(emp.education) : String(emp.education || '[]'),
    position: emp.position || '',
    contacts: emp.contacts || '',
    experience: emp.experience && typeof emp.experience === 'object' ? JSON.stringify(emp.experience) : String(emp.experience || '{}'),
    about: emp.about || '',
    competencies: emp.competencies || '',
    project_experience: emp.project_experience && typeof emp.project_experience === 'object' ? JSON.stringify(emp.project_experience) : String(emp.project_experience || '[]'),
    certification: emp.certification || '',
    email: emp.email || '',
    city: emp.city || '',
    phone: emp.phone || '',
    photo: emp.photo || '',
    is_rp: !!emp.is_rp,
    token: emp.token || uuidv4(),
    token_expires_at: emp.token_expires_at || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    status: emp.status === 'archived' ? 'archived' : 'active',
    created_at: emp.created_at || now,
    updated_at: now,
  };
}

// ─── Настройки ────────────────────────────────────────────────────────────────
async function loadSettings() {
  const rows = await _all('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map(r => [r.key, decryptSetting(r.key, r.value)]));
  try { s.positions = s.positions ? JSON.parse(s.positions) : []; } catch { s.positions = []; }
  return s;
}

async function saveSettings(obj) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, v] of Object.entries(obj)) {
      const val = encryptSetting(k, k === 'positions' ? JSON.stringify(v) : String(v ?? ''));
      await client.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [k, val]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Парсеры legacy-форматов ──────────────────────────────────────────────────
function parseLegacyEducation(val) {
  const lines = String(val || '').split('\n').filter(l => l.trim());
  if (lines.length <= 1) return [{ institution: lines[0] || '', degree: '', specialty: '', year: '' }];
  return [{ institution: lines[0] || '', degree: lines[1] || '', specialty: lines[2] || '', year: lines[3] || '' }];
}

function parseLegacyExperience(val) {
  const text = String(val || '');
  const totalMatch = text.match(/Общий стаж[:\s]+([^\n]+)/i);
  const jobs = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (/Общий стаж/i.test(line)) continue;
    const periodMatch = line.match(/(\d{2}\.\d{4}\s*-\s*\d{2}\.\d{4}|\d{2}\.\d{4}\s*-\s*настоящее\s*время)/i);
    if (periodMatch) {
      const parts = line.split(periodMatch[0]);
      const companyAndPos = (parts[0] || '').trim();
      const period = periodMatch[0];
      const dashIdx = companyAndPos.lastIndexOf(' ');
      const position = dashIdx > 0 ? companyAndPos.slice(dashIdx).trim() : companyAndPos;
      const company = dashIdx > 0 ? companyAndPos.slice(0, dashIdx).trim() : '';
      jobs.push({ company, position, period });
    } else {
      jobs.push({ company: line, position: '', period: '' });
    }
  }
  return { total: totalMatch ? totalMatch[1].trim() : text.split('\n')[0], jobs };
}

function parseLegacyProject(val) {
  const text = String(val || '').trim();
  if (!text) return [];
  const blocks = text.split(/\n\s*\n/);
  return blocks.filter(b => b.trim()).map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    let client = '', projectDescription = '', taskDescription = '', technologies = '';
    for (const line of lines) {
      if (/^Клиент:/i.test(line)) client = line.replace(/^Клиент:\s*/i, '').trim();
      else if (/^(Продукт|Продукты):/i.test(line)) technologies = line.replace(/^(Продукт|Продукты):\s*/i, '').trim();
      else if (/^Области внедрения:/i.test(line)) projectDescription = (projectDescription ? projectDescription + '\n' : '') + line;
      else if (/^Роль:/i.test(line)) taskDescription = (taskDescription ? taskDescription + '\n' : '') + line;
      else projectDescription = (projectDescription ? projectDescription + '\n' : '') + line;
    }
    return { period: '', position: '', role: '', team_size: '', client, project_description: projectDescription, task_description: taskDescription, technologies };
  });
}

// ─── Seed данные ──────────────────────────────────────────────────────────────
const SEED = [
  { name:'Бочкова Виктория Андреевна', education:'Красноярский государственный аграрный университет\nБакалавриат\nЗемлеустройство и кадастры\n2019', position:'Младший консультант по внедрению 1С', contacts:'Новосибирск\nV.Bochkova@is1c.ru', experience:'Общий стаж: 5,5 лет\nАО «Корпоративные ИТ-проекты» Младший консультант по внедрению 1С, 01.2024 - настоящее время', about:'', competencies:'1С:ЗУП; 1С:ДО; бесшовная интеграция с «1С:Документооборотом»; внедрение ЭДО модуль Контур.Диадок для 1С', project_experience:'Клиент: ООО "ИНК"\nПродукты: 1С:ДО, Интеграция с 1С:ДО; модуль Контур.Диадок для 1С\nОбласти внедрения: бесшовная интеграция, работа с ЭДО, сопровождение', certification:'Сертификация 1С:\n1С:Профессионал. Бухгалтерия 8;\n1С:Профессионал. Документооборот 8;\n1С:Профессионал. Управление торговлей 8;\n1С:Специалист-консультант по настройке и администрированию 1С:Документооборота;\n1С:Профессионал. ERP Управление предприятием ред. 2.5;\n1С:Специалист-консультант. Бухгалтерия 8.\n\nОбучающие курсы: -', email:'V.Bochkova@is1c.ru', city:'Новосибирск' },
  { name:'Батуева Мария Юрьевна', education:'Новосибирский государственный технический университет\nКонструкторско-технологическое обеспечение машиностроительных производств\n2025', position:'Стажер-консультант по внедрению 1С', contacts:'Новосибирск\nM.Bytueva@is1c.ru', experience:'Общий стаж: менее 1 года\nАО Корпоративные ИТ-проекты Стажер-консультант, 01.2025 - настоящее время', about:'', competencies:'Складской учет 1С:ERP УХ\nМоделирование БП\nПроектирование БП', project_experience:'2026\nКлиент: крупнейший производитель ПЭТ-упаковочной ленты в СНГ\nПродукт: 1С: ERP УХ\nОбласти внедрения: Складской учет', certification:'Сертификация 1С:\n1С:Профессионал. Управление торговлей 8.\n\nОбучающие курсы: -', email:'M.Bytueva@is1c.ru', city:'Новосибирск' },
  { name:'Рафальский Артём Владимирович', education:'Новосибирский государственный технический университет\nБакалавриат\nМенеджмент организаций\n2022', position:'Старший консультант по внедрению 1С', contacts:'Новосибирск\nA.Rafalskij@is1c.ru', experience:'Общий стаж: 5 лет\nСтаж работы в 1С: 01.2023 - настоящее время', about:'', competencies:'1С:ERP', project_experience:'Казначейство\nЛогистика\nСклады\nЗакупки\nПродажи\nНСИ', certification:'Сертификация 1С:\n1С:Профессионал. Управление торговлей 8;\n1С:Профессионал. Управление холдингом 8;\n1С:Специалист-консультант по внедрению подсистем управленческого учета в 1С:ERP 2;\n1С:Профессионал. ERP Управление предприятием ред. 2.5;\n1С:Профессионал. Бухгалтерия 8.\n\nОбучающие курсы: -', email:'A.Rafalskij@is1c.ru', city:'Новосибирск' },
  { name:'Касимова Анна Владимировна', education:'Уточнить', position:'Младший консультант по внедрению 1С', contacts:'Новосибирск\nA.Kasimova@is1c.ru', experience:'Общий стаж:', about:'', competencies:'', project_experience:'', certification:'Сертификация 1С:\n1С:Профессионал. Платформа 1С:Предприятие 8.3;\n1С:Специалист-консультант по внедрению подсистем регламентированного учета в 1С:ERP 2;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'A.Kasimova@is1c.ru', city:'Новосибирск' },
  { name:'Чайкин Артём Алексеевич', education:'Уточнить', position:'Младший консультант по внедрению 1С', contacts:'Новосибирск\nA.Chaikin@is1c.ru', experience:'Общий стаж:', about:'', competencies:'', project_experience:'', certification:'Сертификация 1С:\n1С:Профессионал. Бухгалтерия 8;\n1С:Специалист-консультант. Бухгалтерия 8;\n1С:Профессионал. ERP Управление предприятием ред. 2.5;\n1С:Профессионал. Документооборот 8.\n\nОбучающие курсы: -', email:'A.Chaikin@is1c.ru', city:'Новосибирск' },
  { name:'Горчакова Екатерина Вадимовна', education:'Уточнить', position:'Эксперт-консультант по внедрению 1С', contacts:'Новосибирск\nE.Gorchakova@is1c.ru', experience:'Общий стаж:', about:'', competencies:'1С:ERP УП 2\n1С: БП КОРП 3.0\n1С УПП 1.3, блок ЗиК 2.5', project_experience:'Регламентированный учет (БУ и НУ)\nНалоговый учет (НДС)\nУчет затрат\nЗакрытие месяца\nЗарплатный учет', certification:'Сертификация 1С:\n1С:Профессионал по подсистеме Международный финансовый учет в 1С:ERP 2;\n1С:Профессионал. ERP Управление предприятием 2;\n1С:Профессионал. Бухгалтерия 8;\n1С:Профессионал. Зарплата и управление персоналом 8;\n1С:Профессионал. Управление торговлей 8;\n1С:Профессионал. Управление холдингом 8.\n\nОбучающие курсы: -', email:'E.Gorchakova@is1c.ru', city:'Новосибирск' },
  { name:'Апухтина Радмила Олеговна', education:'Уточнить', position:'Эксперт-консультант по внедрению 1С', contacts:'Новосибирск\nR.Apuhtina@is1c.ru', experience:'Общий стаж:', about:'', competencies:'1С:ERP УП 2', project_experience:'Оперативный учет (закупки, склад, продажи)', certification:'Сертификация 1С:\n1С:Профессионал. ERP Управление предприятием 2;\n1С:Профессионал. Документооборот 8;\n1С:Профессионал. Зарплата и управление персоналом 8;\n1С:Профессионал. Управление торговлей 8;\n1С:Профессионал. Управление холдингом 8.\n\nОбучающие курсы: -', email:'R.Apuhtina@is1c.ru', city:'Новосибирск' },
  { name:'Мазова Маргарита Михайловна', education:'Сибирский государственный университет путей сообщения\nЭкономика строительного бизнеса', position:'Консультант по внедрению 1С', contacts:'Новосибирск\nM.Mazova@is1c.ru', experience:'Общий стаж: 5 лет\nКонсультант по внедрению 1С, 2021 - настоящее время', about:'', competencies:'1С: ERP', project_experience:'Тестирование; написание инструкций; постановка задач программисту 1С; тестирование на соответствие ТЗ', certification:'Сертификация 1С:\n1С:Специалист-консультант по внедрению подсистем управленческого учета в 1С:ERP 2;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'M.Mazova@is1c.ru', city:'Новосибирск' },
  { name:'Бордавкова Ксения Анатольевна', education:'Ульяновский государственный педагогический университет\nПреподаватель географии и экологии', position:'Консультант по внедрению 1С', contacts:'Ульяновск\nK.Bordavkova@is1c.ru', experience:'Общий стаж: 5 лет\nКонсультант по внедрению 1С, 2023 - настоящее время', about:'', competencies:'1С: ERP Управление предприятием 2;\n1С: Управление холдингом 3;\nТранспортная логистика КОРП;\nГНИВЦ: Налоговый мониторинг', project_experience:'Продукт: 1С: ERP Управление предприятием 2\nОбласти внедрения: Блок «Казначейство»\n\nПродукт: 1С: Управление холдингом 3\nОбласти внедрения: Блок «Согласование»', certification:'Сертификация 1С:\n1С:Профессионал. Документооборот 8;\n1С:Профессионал. Зарплата и управление персоналом 8;\n1С:Профессионал. Управление холдингом 8;\n1С:Специалист-консультант по внедрению подсистем управленческого учета в 1С:ERP 2;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'K.Bordavkova@is1c.ru', city:'Ульяновск' },
  { name:'Барышников Артём Алексеевич', education:'Алтайский государственный технический университет им. И.И. Ползунова\n2026', position:'Стажер-консультант по внедрению 1С', contacts:'Барнаул\nA.Baryshnikov@is1c.ru', experience:'Общий стаж: 1 год\nАО «Корпоративные ИТ-проекты» Стажер-консультант, 2024 - настоящее время', about:'', competencies:'- Знание нотаций IDEF0, BPMN\n- Навыки формализации требований\n- Умение работать на стыке бизнеса и IT\n- Навыки обучения и создания инструкций', project_experience:'Клиент: поставщик ПО в сфере автоматизации управления предприятиями\nПродукты: 1С: ЗУП, СУЗ, ДО\n- Обследование бизнес-процессов\n- Разработка ТЗ\n- Тестирование функционала\n- Обучение пользователей', certification:'Сертификация 1С: нет данных — уточнить у сотрудника.\n\nОбучающие курсы: -', email:'A.Baryshnikov@is1c.ru', city:'Барнаул' },
  { name:'Ворок Евгения Владимировна', education:'Алтайская академия экономики и права\nВысшее, экономическое, 2008', position:'Эксперт-консультант по внедрению 1С', contacts:'Новосибирск\nE.Vorok@is1c.ru', experience:'Общий стаж: 22 года\nСтаж в 1С: 13 лет\n2013 - настоящее время АО Корпоративные ИТ-проекты', about:'', competencies:'• Знание БУ и НУ при ОСН и УСН на базе 1С:БП, КА 2.4, ERP 2.5\n• Внедрение подсистем ЗУП в БП, ЗУП, КА, ERP\n• Составление регламентированной отчётности (НДС, прибыль, взносы, НДФЛ)\n• Опыт преподавательской деятельности и публикации статей', project_experience:'2025-2026\nКлиент: Независимая нефтегазодобывающая компания\nПродукт: 1С ERP. Управление холдингом 3.3\nПереход с ERP2.5.22\n\n2024-2025\nКлиент: Независимая нефтегазодобывающая компания\nПродукт: 1С: ERP\nОбласти внедрения: Регл.контур, блок НДС', certification:'Сертификация 1С:\n1С:Профессионал. ERP Управление предприятием 2;\n1С:Профессионал. Бухгалтерия 8;\n1С:Профессионал. Зарплата и управление персоналом 8;\n1С:Профессионал. Платформа 1С:Предприятие 8.3;\n1С:Профессионал. Управление торговлей 8;\n1С:Профессионал. Управление холдингом 8.\n\nОбучающие курсы: -', email:'E.Vorok@is1c.ru', city:'Новосибирск' },
  { name:'Коваленко Мария Владимировна', education:'Сибирский государственный университет телекоммуникаций и информатики\nИнфокоммуникационные технологии и системы связи\n2020', position:'Старший консультант по внедрению 1С', contacts:'Новосибирск\nM.Fedorova@is1c.ru', experience:'Общий стаж: 5 лет\nАО Корпоративные ИТ-проекты Старший консультант, 2023 - настоящее время', about:'', competencies:'1С:ЗУП КОРП — кадровый учет, заработная плата\nСбор требований\nМоделирование бизнес-процессов\nПроектирование интеграций с 1С:ERP, 1С:УХ, 1С:ТЛЭ\nНаписание технических заданий', project_experience:'Клиент: Крупное сельскохозяйственное предприятие\nПродукт: 1С:ЗУП КОРП\nОбласти внедрения: Кадровый учет, заработная плата\n\nКлиент: Крупнейшая телевизионная и радиовещательная компания\nПродукт: 1С:ЗУП КОРП\nОбласти внедрения: Централизация баз филиалов; миграция данных', certification:'Сертификация 1С:\n1С:Профессионал. Бухгалтерия 8;\n1С:Профессионал. Зарплата и управление персоналом 8;\n1С:Профессионал. Управление торговлей 8;\n1С:Профессионал. Управление холдингом 8;\n1С:Специалист-консультант. Зарплата и управление персоналом 8;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'M.Fedorova@is1c.ru', city:'Новосибирск' },
  { name:'Афанасьева Анастасия Евгеньевна', education:'Новосибирский государственный университет экономики и управления\nБухгалтерский учет, анализ и аудит\n2014', position:'Ведущий консультант по внедрению 1С', contacts:'Новосибирск\nA.Afanaseva@is1c.ru', experience:'Общий стаж: 15 лет\nАО «Корпоративные ИТ-проекты» Ведущий консультант, 2022 – настоящее время', about:'', competencies:'Налоговый мониторинг (1С:УХ, ГНИВЦ:НМ)\nМСФО (1C:НМ)\nФинансовый учет, Казначейство (1С:ERP)\nСкладской учет (1С:ERP)\nУчет ВНА (1С:ERP)', project_experience:'2025\nКлиент: крупнейший производитель ПЭТ-упаковочной ленты в СНГ\nПродукт: 1С: ERP УХ\nРоль: Ведущий консультант\n\n2023-2024\nКлиент: крупный производитель электроинструментов\nПродукт: 1С: Управление холдингом\nОбласти внедрения: Налоговый мониторинг; Интеграция с АИС Налог-3\nРоль: Ведущий консультант', certification:'Сертификация 1С:\n1С:Специалист-консультант по внедрению подсистемы "Бюджетирование" в 1С:ERP 2;\n1С:Профессионал. Управление холдингом 8;\n1С:Профессионал по 1С:Бухгалтерия 8;\n1С:Специалист-консультант по регламентированному учету в ERP;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'A.Afanaseva@is1c.ru', city:'Новосибирск' },
  { name:'Афанасьев Вячеслав Андреевич', education:'Новосибирский государственный технический университет\nАвтоматизация технологических процессов и производств в машиностроении\n2005', position:'Консультант по внедрению 1С', contacts:'Новосибирск\nV.Afanasev@is1c.ru', experience:'Общий стаж: 20 лет\nАО «Корпоративные ИТ-проекты» Консультант, 2022 – настоящее время', about:'', competencies:'Складской учет, Закупки, Продажи, Маркетинг, Логистика (1C:ERP), 1С:ТоиР, 1С:УАТ, 1С:УТ, 1С:УНФ', project_experience:'Клиент: ООО ЛИФТ-КОМПЛЕКС ДС\nПродукты: 1С:ERP\nОбласти внедрения: Складской учет\n\nКлиент: ООО «ИНК-ИЗП»\nПродукты: 1С:ERP\nОбласти внедрения: Логистика\n\nКлиент: АО "Новосибирский патронный завод"\nОбласти внедрения: Сопровождение', certification:'Сертификация 1С:\n1С:Специалист-консультант по зарплате и управлению персоналом 8;\n1С:Специалист-консультант по регламентированному учету в ERP;\n1С:Профессионал. Управление торговлей 8;\n1С:Профессионал. Документооборот 8;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'V.Afanasev@is1c.ru', city:'Новосибирск' },
  { name:'Токмин Михаил Александрович', education:'Новосибирский государственный университет экономики и управления\n2026', position:'Стажер-консультант по внедрению 1С', contacts:'Новосибирск\nM.Tokmin@is1c.ru', experience:'Общий стаж: 1 год\nАО «Корпоративные ИТ-проекты» Стажер-консультант, 2025 - настоящее время', about:'', competencies:'- Знание нотаций IDEF0, BPMN, DFD, EPC\n- Навыки формализации требований\n- Умение работать на стыке бизнеса и IT\n- Навыки обучения и создания инструкций', project_experience:'Клиент: поставщик ПО в сфере автоматизации управления предприятиями\nПродукты: 1С: ЗУП, СУЗ, ДО\n- Обследование бизнес-процессов\n- Разработка ТЗ\n- Тестирование функционала\n- Обучение пользователей', certification:'Сертификация 1С: нет данных — уточнить у сотрудника.\n\nОбучающие курсы: -', email:'M.Tokmin@is1c.ru', city:'Новосибирск' },
  { name:'Ильенко Александра Вячеславовна', education:'Сибирский государственный университет телекоммуникаций и информатики\nПрикладная информатика в экономике\n2021', position:'Старший консультант по внедрению 1С', contacts:'Новосибирск\nA.Ilenko@is1c.ru', experience:'Общий стаж: 7 лет\nИнфоСофт Старший консультант, 2021 - настоящее время', about:'', competencies:'1С: ДО, 1С: ERP, Интеграции и Обмены, продуктовая разработка, UX-UI на 1С', project_experience:'Клиент: АО АПЗ Ротор\nПродукты: 1С:Документооборот, 1С:ERP\nОбласти внедрения: автоматизация документооборота, интеграция с 1С:ERP\n\nКлиент: ООО «ИНК»\nПродукты: 1С:Документооборот, 1С:ERP, 1С:УПП\nОбласти внедрения: интеграция систем, автоматизация документов, ЭДО', certification:'Сертификация 1С:\n1С:Специалист-консультант по "Управление торговлей 8";\n1С:Специалист-консультант по внедрению подсистемы "Бюджетирование" в 1С:ERP 2;\n1С:Специалист-консультант по настройке и администрированию "1С:Документооборота";\n1С:Профессионал. ERP Управление предприятием 2;\n1С:CRM.\n\nОбучающие курсы: -', email:'A.Ilenko@is1c.ru', city:'Новосибирск' },
  { name:'Бородина Екатерина Алексеевна', education:'Алтайский государственный технический университет им. И.И. Ползунова\nСпециалист по рекламе\n2009', position:'Старший консультант по внедрению 1С', contacts:'Барнаул\nE.Borodina@is1c.ru', experience:'Общий стаж: 19,5 лет\nАО "Корпоративные ИТ-проекты" Консультант, 2023 - настоящее время', about:'', competencies:'Управление инженерными данными\nПланирование производства\nДиспетчеризация производства\nПроизводственный учет (МЗК, МЦК, МУК)\nНормирование труда\nКонтроль в производстве', project_experience:'Клиент: ООО НЭМЗ «Тайра»\nПродукты: 1С:ERP\nОбласти внедрения: управление производством, сопровождение\n\nКлиент: АО "Новосибирский патронный завод"\nПродукты: 1С:ERP\nОбласти внедрения: управление складом, производством, учёт рабочего времени', certification:'Сертификация 1С:\n1С:Профессионал. Управление торговлей 8;\n1С:Специалист-консультант по управленческому учету в ERP;\n1С:Специалист-консультант по управлению производством в ERP;\n1С:Профессионал. ERP Управление предприятием ред. 2.5.\n\nОбучающие курсы: -', email:'E.Borodina@is1c.ru', city:'Барнаул' },
  { name:'Сафина Зарина Илдаровна', education:'Сибирский университет потребительской кооперации\nБухгалтерский учет, анализ и аудит\n2007', position:'Эксперт-консультант по внедрению 1С', contacts:'Новосибирск\nZ.Safina@is1c.ru', experience:'Общий стаж: 18 лет\nАО «Корпоративные ИТ-проекты» Эксперт-консультант, 2019 – настоящее время', about:'', competencies:'• Моделирование бизнес процессов\n• Глубокое знание бухгалтерского и налогового учёта\n• Разработка технических заданий\n• Тестирование доработок\n• Разработка инструкций', project_experience:'2023-2025\nКлиент: Крупное сельскохозяйственное предприятие\nПродукты: 1С:ERP, 1С УХ\nОбласти внедрения: Полный оперативный контур; Регламентированный учёт\nРоль: Ведущий аналитик/Функциональный архитектор\n\n2021-2023\nКлиент: Завод по производству шин\nПродукты: 1С:ERP УХ\nРоль: Ведущий аналитик', certification:'Сертификация 1С:\n1С:Профессионал. ERP Управление предприятием 2;\n1С:Профессионал. Бухгалтерия 8;\n1С:Профессионал. Документооборот 8;\n1С:Специалист-консультант по внедрению подсистем управленческого учёта в 1С:ERP 2;\n1С:Специалист-консультант по внедрению подсистем регламентированного учёта в 1С:ERP 2.\n\nОбучающие курсы: -', email:'Z.Safina@is1c.ru', city:'Новосибирск' },
];

// ─── Инициализация БД ─────────────────────────────────────────────────────────
async function init() {
  await _run(SCHEMA_SQL);

  // Миграции колонок (IF NOT EXISTS для PostgreSQL)
  await _run("ALTER TABLE employees ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'").catch(() => {});
  await _run("ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_rp BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});
  await _run("ALTER TABLE employees ADD COLUMN IF NOT EXISTS token_expires_at TEXT DEFAULT ''").catch(() => {});
  await _run("UPDATE employees SET token_expires_at = $1 WHERE token_expires_at IS NULL OR token_expires_at = ''", [new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()]).catch(() => {});
  await _run("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_token_unique ON employees(token) WHERE token IS NOT NULL AND token <> ''").catch(() => {});
  await _run("ALTER TABLE pending_changes ADD COLUMN IF NOT EXISTS reviewed_by TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS reverted_at TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS reverted_by TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS decision_status TEXT NOT NULL DEFAULT 'approved'").catch(() => {});
  await _run("ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS reject_reason TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS returned_to_pending_at TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE approval_history ADD COLUMN IF NOT EXISTS returned_to_pending_by TEXT DEFAULT ''").catch(() => {});
  await _run('ALTER TABLE approval_history DROP CONSTRAINT IF EXISTS approval_history_source_change_id_key').catch(() => {});

  // Переносим уже подтверждённые изменения в постоянный журнал.
  await _run(`
    INSERT INTO approval_history (
      source_change_id, employee_id, employee_name, employee_position,
      field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by,
      decision_status
    )
    SELECT pc.id, pc.employee_id, COALESCE(e.name, ''), COALESCE(e.position, ''),
           pc.field_name, pc.old_value, pc.new_value, pc.submitted_at,
           COALESCE(NULLIF(pc.reviewed_at, ''), pc.submitted_at), pc.reviewed_by,
           'approved'
    FROM pending_changes pc
    LEFT JOIN employees e ON e.id = pc.employee_id
    WHERE pc.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM approval_history ah
        WHERE ah.source_change_id = pc.id AND ah.decision_status = 'approved'
      )
  `);

  // Переносим уже отклонённые изменения в тот же журнал решений.
  await _run(`
    INSERT INTO approval_history (
      source_change_id, employee_id, employee_name, employee_position,
      field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by,
      decision_status, reject_reason
    )
    SELECT pc.id, pc.employee_id, COALESCE(e.name, ''), COALESCE(e.position, ''),
           pc.field_name, pc.old_value, pc.new_value, pc.submitted_at,
           COALESCE(NULLIF(pc.reviewed_at, ''), pc.submitted_at), pc.reviewed_by,
           'rejected', pc.reject_reason
    FROM pending_changes pc
    LEFT JOIN employees e ON e.id = pc.employee_id
    WHERE pc.status = 'rejected'
      AND NOT EXISTS (
        SELECT 1 FROM approval_history ah
        WHERE ah.source_change_id = pc.id AND ah.decision_status = 'rejected'
      )
  `);
  await _run("ALTER TABLE managers ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'").catch(() => {});
  await _run("ALTER TABLE managers ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL").catch(() => {});
  await _run(`
    UPDATE managers m
    SET employee_id = (
      SELECT e.id
      FROM employees e
      WHERE e.status <> 'archived'
        AND e.name_lower = LOWER(REGEXP_REPLACE(TRIM(m.name), '[[:space:]]+', ' ', 'g'))
      ORDER BY e.id
      LIMIT 1
    )
    WHERE m.role = 'leader' AND m.employee_id IS NULL
  `).catch(() => {});
  await _run(`
    UPDATE employees e
    SET is_rp = TRUE, updated_at = COALESCE(NULLIF(e.updated_at, ''), $1)
    FROM managers m
    WHERE m.role = 'leader' AND m.employee_id = e.id AND e.is_rp = FALSE
  `, [new Date().toISOString()]).catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Черновик'").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS code_name TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS legal_customer_name TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS industry_description TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_period TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_period TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_present BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_size INTEGER DEFAULT 0").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS technologies TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS functional_area TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS functional_blocks TEXT DEFAULT '[]'").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_members TEXT DEFAULT '[]'").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS leader_id INTEGER REFERENCES managers(id) ON DELETE SET NULL").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS leader_name TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS sent_at TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS leader_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_data TEXT DEFAULT '[]'").catch(() => {});

  // В старых импортированных проектах колонка УПП «Функциональная область»
  // ошибочно хранилась как выбранные РП функциональные блоки. Разделяем данные.
  const areaMigration = await _get("SELECT value FROM settings WHERE key = 'migration_upp_functional_area_v1'");
  if (!areaMigration) {
    const importedProjects = await _all("SELECT id, functional_blocks, team_members, source_data FROM projects WHERE source_system = 'УПП'");
    const migratedProjectIds = [];
    for (const project of importedProjects) {
      let sourceRows = [];
      let blocks = [];
      try { sourceRows = JSON.parse(project.source_data || '[]'); } catch {}
      try { blocks = JSON.parse(project.functional_blocks || '[]'); } catch {}
      let teamMembers = [];
      try { teamMembers = JSON.parse(project.team_members || '[]'); } catch {}
      const areas = [...new Set(sourceRows.map(row => String(row?.functionalBlock || '').trim()).filter(Boolean))];
      const areaKeys = new Set(areas.map(value => value.toLowerCase()));
      const rpBlocks = (Array.isArray(blocks) ? blocks : []).filter(value => !areaKeys.has(String(value || '').trim().toLowerCase()));
      const migratedMembers = (Array.isArray(teamMembers) ? teamMembers : []).map(member => {
        const functionalAreas = Array.isArray(member.functional_areas)
          ? member.functional_areas
          : (Array.isArray(member.functional_blocks) ? member.functional_blocks : []);
        const { functional_blocks, ...rest } = member;
        return { ...rest, functional_areas: functionalAreas };
      });
      await _run('UPDATE projects SET functional_area = $1, functional_blocks = $2, team_members = $3 WHERE id = $4', [areas.join(', '), JSON.stringify(rpBlocks), JSON.stringify(migratedMembers), project.id]);
      migratedProjectIds.push(Number(project.id));
    }
    await _run("INSERT INTO settings (key, value) VALUES ('migration_upp_functional_area_v1', 'done') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
    if (migratedProjectIds.length) {
      const migratedProjects = await helpers.getProjectsByIds(migratedProjectIds);
      for (const project of migratedProjects) await helpers.syncProjectTeamMembers(project);
    }
  }

  // Create indexes only after legacy tables have received all required columns.
  await _run('CREATE INDEX IF NOT EXISTS idx_employees_token ON employees(token)');
  await _run('CREATE INDEX IF NOT EXISTS idx_employees_name_lower ON employees(name_lower)');
  await _run('CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)');
  await _run('CREATE INDEX IF NOT EXISTS idx_changes_status ON pending_changes(status)');
  await _run('CREATE INDEX IF NOT EXISTS idx_changes_employee ON pending_changes(employee_id)');
  await _run('CREATE INDEX IF NOT EXISTS idx_approval_history_reviewed_at ON approval_history(reviewed_at DESC)');
  await _run('CREATE INDEX IF NOT EXISTS idx_approval_history_employee ON approval_history(employee_id)');
  await _run('CREATE INDEX IF NOT EXISTS idx_approval_history_source_change ON approval_history(source_change_id)');
  await _run('CREATE INDEX IF NOT EXISTS idx_feedback_employee ON employee_feedback(employee_id)');
  await _run('CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)');
  await _run('CREATE INDEX IF NOT EXISTS idx_projects_leader ON projects(leader_id)');
  await _run('CREATE INDEX IF NOT EXISTS idx_projects_leader_employee ON projects(leader_employee_id)');
  await _run('CREATE UNIQUE INDEX IF NOT EXISTS idx_managers_employee_unique ON managers(employee_id) WHERE employee_id IS NOT NULL');

  // Очищаем ранее созданные ложные изменения, где различались только
  // служебные или управляемые РП поля связанного проекта.
  const pendingProjectChanges = await _all(
    "SELECT id, old_value, new_value FROM pending_changes WHERE status = 'pending' AND field_name = 'project_experience'"
  );
  const noOpProjectChangeIds = pendingProjectChanges
    .filter(change => normalizeForComparison('project_experience', change.old_value) === normalizeForComparison('project_experience', change.new_value))
    .map(change => Number(change.id));
  if (noOpProjectChangeIds.length) {
    await _run('DELETE FROM pending_changes WHERE id = ANY($1::int[])', [noOpProjectChangeIds]);
    console.log(`Удалены ложные изменения проектного опыта: ${noOpProjectChangeIds.length}`);
  }

  // Настройки умолчания
  let settings = await loadSettings();
  let changed = false;
  const defs = { 
    smtp_host:'', smtp_port:'587', smtp_user:'', smtp_pass:'', smtp_from:'Портфолио IS1C <noreply@is1c.ru>', manager_email:'',
    ai_provider: 'yandexgpt',
    ai_api_key: '',
    ai_folder_id: '',
    ai_base_url: 'https://api.openai.com/v1',
    ai_model_name: 'gpt-3.5-turbo',
    ai_prompt_fill: 'Ты опытный HR-специалист. Улучши стиль написания, исправь грамматические и орфографические ошибки в тексте, сохранив смысл. Текст должен звучать профессионально. Верни только исправленный текст без преамбул.',
    ai_prompt_review: 'Ты строгий HR-ревьюер. Проанализируй текст и укажи на несоответствия, логические или орфографические ошибки. Верни результат в виде краткого списка замечаний. Если всё отлично, напиши "Замечаний нет".',
    ai_prompt_summarize: 'Ты опытный HR-аналитик. Проанализируй список отзывов сотрудников о компании и составь краткое резюме: выдели основные плюсы, минусы и общие настроения.'
  };
  for (const [k,v] of Object.entries(defs)) { if (settings[k] === undefined) { settings[k] = v; changed = true; } }
  for (const key of SECRET_SETTING_KEYS) {
    const raw = await _get('SELECT value FROM settings WHERE key = $1', [key]);
    if (raw?.value && !String(raw.value).startsWith('enc:v1:')) {
      await _run('UPDATE settings SET value = $1 WHERE key = $2', [encryptSetting(key, raw.value), key]);
    }
  }
  if (!settings.positions || !Array.isArray(settings.positions) || settings.positions.length === 0) {
    settings.positions = ['Стажер-консультант по внедрению 1С','Младший консультант по внедрению 1С','Консультант по внедрению 1С','Старший консультант по внедрению 1С','Ведущий консультант по внедрению 1С','Эксперт-консультант по внедрению 1С'];
    changed = true;
  }
  if (changed) await saveSettings(settings);

  // Миграция: переименовать 'Аналитик' → 'Консультант' в компетенциях
  const oldComps = await helpers.getPositionCompetencies();
  if (oldComps['Аналитик'] !== undefined && oldComps['Консультант'] === undefined) {
    oldComps['Консультант'] = oldComps['Аналитик'];
    delete oldComps['Аналитик'];
    helpers.setPositionCompetencies(oldComps);
    console.log('✅ Компетенции: группа «Аналитик» переименована в «Консультант»');
  }

  // Seed компетенций по умолчанию
  const comps = await helpers.getPositionCompetencies();
  const DEFAULT_COMPS = {
    'Разработчик': [
      'Знание объектов метаданных, управляемых форм, языка запросов, СКД',
      'Понимание клиент-серверной архитектуры и транзакций',
      'Опыт модификации типовых конфигураций (ERP, УТ, ДО, БП, ЗУП)',
      'Модификация через расширения и подписки на события',
      'Веб-сервисы и HTTP-сервисы (SOAP/REST)',
      'Обмены данными XML/JSON',
      'Работа с Git, SVN',
      'Автотестирование (Vanessa Automation) / статанализ (SonarQube, BSL LS)',
      'Написание читаемого, структурированного кода',
      'Работа с чужим кодом, диагностика ошибок',
      'Самостоятельный анализ задач и оценка сроков',
      'Функциональное тестирование и регресс по чек-листу',
    ],
    'Архитектор': [
      'Формирование функциональной архитектуры системы',
      'Проектирование интеграционных решений (ESB, HTTP, RabbitMQ)',
      'Проектирование миграции данных из legacy-систем',
      'Управление требованиями на уровне бизнес-целей',
      'Организация приемки и сдачи функциональности',
      'Оценка трудоемкости и ресурсное планирование',
      'Экспертное владение 1С:ERP / 1С:ЗУП КОРП',
      'Знание отраслевого учета (МСФО, регламентированный учет)',
      'Стратегическое видение проекта',
      'Управление командой аналитиков и разработчиков',
      'Презентация решений перед заказчиком',
      'Управление функциональными и техническими рисками',
    ],
    'Консультант': [
      'Проведение обследования и интервьюирование пользователей',
      'Анализ бизнес-процессов (AS IS / TO BE)',
      'Моделирование в нотациях BPMN, EPC',
      'GAP-анализ',
      'Сбор и формализация требований',
      'Разработка проектной документации (ТЗ, ЧТЗ, инструкции, ПМИ)',
      'Знание бухгалтерского, налогового, кадрового учета',
      'Постановка задач разработчикам',
      'Участие в тестировании функционала',
      'Навыки деловой переписки и коммуникации',
      'Обучение и консультирование пользователей',
      'Написание базовых SQL/1С-запросов',
    ],
  };
  if (Object.keys(comps).length === 0) {
    helpers.setPositionCompetencies(DEFAULT_COMPS);
    console.log('✅ Компетенции: установлены значения по умолчанию');
  }

  // Создать первого менеджера, если нет ни одного
  const mgrCount = await _get('SELECT COUNT(*)::int cnt FROM managers');
  if (mgrCount.cnt === 0) {
    const hash = settings.manager_password_hash || bcrypt.hashSync(config.defaultManagerPassword, 12);
    const email = config.defaultManagerEmail;
    await _run(
      'INSERT INTO managers (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
      ['Главный администратор', email, hash, 'admin', new Date().toISOString()]
    );
    console.log(`✅ Создан менеджер по умолчанию: ${email}`);
  }

  // Миграция: установить роль всем менеджерам без роли
  await _run("UPDATE managers SET role = 'admin' WHERE role IS NULL OR role = ''");
  // Миграция: удалить старый manager_password_hash
  if (settings.manager_password_hash) {
    await _run("DELETE FROM settings WHERE key = 'manager_password_hash'");
  }

  // Пост-миграции: конвертировать legacy-текст в JSON
  const allRows = await _all("SELECT id, education, experience, project_experience FROM employees");
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of allRows) {
      if (row.education && !row.education.startsWith('[') && row.education.trim()) {
        const parsed = parseLegacyEducationLines(row.education);
        await client.query('UPDATE employees SET education = $1 WHERE id = $2', [JSON.stringify(parsed), row.id]);
      }
      if (row.experience && !row.experience.startsWith('{') && row.experience.trim()) {
        const parsed = parseLegacyExperience(row.experience);
        await client.query('UPDATE employees SET experience = $1 WHERE id = $2', [JSON.stringify(parsed), row.id]);
      }
      if (row.project_experience && !row.project_experience.startsWith('[') && row.project_experience.trim()) {
        const parsed = parseLegacyProject(row.project_experience);
        await client.query('UPDATE employees SET project_experience = $1 WHERE id = $2', [JSON.stringify(parsed), row.id]);
      }
    }
    await client.query("DELETE FROM pending_changes WHERE field_name IN ('courses','cert_date')");
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Seed если пусто
  const empCount = await _get('SELECT COUNT(*)::int cnt FROM employees');
  if (empCount.cnt === 0) {
    const seedClient = await pool.connect();
    try {
      await seedClient.query('BEGIN');
      for (const s of SEED) {
        const p = prepEmployee({
          ...s,
          education: parseLegacyEducation(s.education),
          experience: parseLegacyExperience(s.experience),
          project_experience: parseLegacyProject(s.project_experience),
        });
        const cols = Object.keys(p);
        const vals = Object.values(p);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        await seedClient.query(
          `INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders})`,
          vals
        );
      }
      await seedClient.query('COMMIT');
      console.log(`✅ Засеяно ${SEED.length} сотрудников`);
    } catch (err) {
      await seedClient.query('ROLLBACK');
      throw err;
    } finally {
      seedClient.release();
    }
  }

  // Очистка просроченных сессий
  setInterval(() => {
    _run('DELETE FROM sessions WHERE expired <= $1', [Date.now()]).catch(() => {});
  }, 15 * 60 * 1000);

  // Очистка брошенных фото
  const cleanupPhotos = async () => {
    try {
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) return;
      const files = fs.readdirSync(uploadsDir);
      if (files.length === 0) return;
      const empRows = await _all("SELECT photo FROM employees WHERE photo != ''");
      const pendRows = await _all("SELECT old_value, new_value FROM pending_changes WHERE field_name = 'photo'");
      const used = new Set();
      empRows.forEach(r => used.add(r.photo));
      pendRows.forEach(r => {
        if (r.old_value) used.add(r.old_value);
        if (r.new_value) used.add(r.new_value);
      });
      const now = Date.now();
      for (const file of files) {
        if (file === '.gitkeep') continue;
        if (!used.has(file)) {
          const filePath = path.join(uploadsDir, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
            console.log(`✅ Удалено неиспользуемое фото: ${file}`);
          }
        }
      }
    } catch (e) { console.error('Ошибка при очистке фото:', e); }
  };
  cleanupPhotos();
  setInterval(cleanupPhotos, 60 * 60 * 1000);
}

// ─── Публичные helpers ────────────────────────────────────────────────────────
const helpers = {
  // ── Настройки ───────────────────────────────────────────────────────────────
  getSetting(key) {
    return _get('SELECT value FROM settings WHERE key = $1', [key]).then(r => r ? decryptSetting(key, r.value) : '');
  },
  setSetting(key, value) {
    return _run(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, encryptSetting(key, value)]
    );
  },

  // ── Сотрудники ───────────────────────────────────────────────────────────────
  async getAllEmployees() {
    const employees = castEmployees(await _all("SELECT * FROM employees ORDER BY CASE WHEN status='archived' THEN 1 ELSE 0 END, name_lower"));
    const pendingRows = await _all('SELECT DISTINCT employee_id FROM pending_changes WHERE status = $1', ['pending']);
    const pendingIds = new Set(pendingRows.map(r => r.employee_id));
    return employees.map(e => ({ ...e, pendingCount: pendingIds.has(e.id) ? 1 : 0 }));
  },

  async getEmployeesByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    return _all("SELECT id, name FROM employees WHERE id = ANY($1::int[]) AND status = 'active'", [ids.map(Number)]);
  },

  async getProjectsByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const projects = await _all(`
      SELECT p.*,
             e.name AS leader_employee_name, e.email AS leader_employee_email
      FROM projects p
      LEFT JOIN employees e ON e.id = p.leader_employee_id
      WHERE p.id = ANY($1::int[])
      ORDER BY p.created_at DESC, p.id DESC
    `, [ids.map(Number)]).then(castProjects);
    return withProjectDateChecks(await withActiveProjectMembers(projects));
  },

  async syncEmployeeProjectExperience(employeeId, project) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const empRes = await client.query('SELECT id, project_experience FROM employees WHERE id = $1', [Number(employeeId)]);
      const emp = empRes.rows[0];
      if (!emp) { await client.query('ROLLBACK'); return null; }

      let current = [];
      try { current = JSON.parse(emp.project_experience || '[]'); } catch { current = parseLegacyProject(emp.project_experience); }
      if (!Array.isArray(current)) current = [];

      const existingEntry = current.find(item => Number(item?.project_id || 0) === Number(project?.project_id || project?.id || 0));
      const preservePersonalPeriod = Boolean(existingEntry?.period_overridden);
      const nextEntry = {
        project_id: project?.project_id || project?.id || null,
        period: preservePersonalPeriod ? (existingEntry?.period || '') : (project?.period || ''),
        period_overridden: preservePersonalPeriod,
        project_name: project?.project_name || '',
        position: project?.position || '',
        role: project?.role || '',
        team_size: String(project?.team_size || ''),
        client: project?.client || project?.customer || '',
        project_description: project?.project_description || '',
        task_description: project?.task_description || '',
        functional_area: project?.functional_area || '',
        technologies: project?.technologies || '',
        functional_blocks: Array.isArray(project?.functional_blocks) ? project.functional_blocks : [],
      };

      const sameKey = (p) => [p?.project_name || '', p?.client || ''].join('|').toLowerCase();
      const filtered = current.filter(item => {
        if (nextEntry.project_id && Number(item?.project_id) === Number(nextEntry.project_id)) return false;
        return sameKey(item) !== sameKey(nextEntry);
      });
      filtered.unshift(nextEntry);

      await client.query('UPDATE employees SET project_experience = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(filtered), new Date().toISOString(), Number(employeeId)]);
      const updated = await client.query('SELECT * FROM employees WHERE id = $1', [Number(employeeId)]);
      await client.query('COMMIT');
      return castEmployee(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  getEmployee(id) {
    return _get('SELECT * FROM employees WHERE id = $1', [Number(id)]).then(castEmployee);
  },

  getEmployeeByToken(token) {
    return _get("SELECT * FROM employees WHERE token = $1 AND (token_expires_at = '' OR token_expires_at > $2)", [token, new Date().toISOString()]).then(castEmployee);
  },

  async createEmployee(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const norm = normalizeName(data.name);
      const existing = await client.query('SELECT * FROM employees WHERE name_lower = $1 LIMIT 1', [norm]);
      if (existing.rows.length > 0) {
        const now = new Date().toISOString();
        const p = prepEmployee(data);
        const setClauses = [];
        const params = [now, existing.rows[0].id];
        let idx = 3;
        for (const [k, v] of Object.entries(p)) {
          if (k === 'token' || k === 'created_at' || k === 'updated_at') continue;
          setClauses.push(`${k} = $${idx}`);
          params.push(v);
          idx++;
        }
        setClauses.push('updated_at = $1');
        await client.query(`UPDATE employees SET ${setClauses.join(', ')} WHERE id = $2`, params);
        const updated = await client.query('SELECT * FROM employees WHERE id = $1', [existing.rows[0].id]);
        await client.query('COMMIT');
        return castEmployee(updated.rows[0]);
      }
      const p = prepEmployee(data);
      const cols = Object.keys(p);
      const vals = Object.values(p);
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      await client.query('COMMIT');
      return castEmployee(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateEmployee(id, fields) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const emp = await client.query('SELECT * FROM employees WHERE id = $1', [Number(id)]);
      if (!emp.rows[0]) { await client.query('ROLLBACK'); return null; }
      const now = new Date().toISOString();
      const updates = {};
      for (const k of ALLOWED_FIELDS) {
        if (fields[k] !== undefined) updates[k] = fields[k];
      }
      if (Object.keys(updates).length === 0) {
        await client.query('COMMIT');
        return castEmployee(emp.rows[0]);
      }
      const setClauses = [];
      const params = [Number(id)];
      let idx = 2;
      for (const [k, v] of Object.entries(updates)) {
        setClauses.push(`${k} = $${idx}`);
        params.push(typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
        idx++;
      }
      if (updates.name) {
        setClauses.push(`name_lower = $${idx}`);
        params.push(normalizeName(updates.name));
        idx++;
      }
      setClauses.push(`updated_at = $${idx}`);
      params.push(now);
      const sql = `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $1`;
      await client.query(sql, params);
      const updated = await client.query('SELECT * FROM employees WHERE id = $1', [Number(id)]);
      await client.query('COMMIT');
      return castEmployee(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async regenerateToken(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const emp = await client.query('SELECT * FROM employees WHERE id = $1', [Number(id)]);
      if (!emp.rows[0]) { await client.query('ROLLBACK'); return null; }
      const newToken = uuidv4();
      const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
      await client.query('UPDATE employees SET token = $1, token_expires_at = $2, updated_at = $3 WHERE id = $4', [newToken, expiresAt, new Date().toISOString(), Number(id)]);
      await client.query('COMMIT');
      return castEmployee({ ...emp.rows[0], token: newToken, token_expires_at: expiresAt });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async archiveEmployee(id) {
    const emp = await _get('SELECT * FROM employees WHERE id = $1', [Number(id)]);
    if (!emp) return false;
    await _run("UPDATE employees SET status='archived', updated_at=$1 WHERE id=$2", [new Date().toISOString(), Number(id)]);
    return true;
  },

  async restoreEmployee(id) {
    const emp = await _get('SELECT * FROM employees WHERE id = $1', [Number(id)]);
    if (!emp) return false;
    await _run("UPDATE employees SET status='active', updated_at=$1 WHERE id=$2", [new Date().toISOString(), Number(id)]);
    return true;
  },

  // Безвозвратное удаление сотрудника. Разрешено только для уже архивированных
  // записей — защита от случайного удаления активного сотрудника мимо архива.
  // pending_changes и employee_feedback удаляются автоматически (ON DELETE CASCADE).
  async deleteEmployeePermanently(id) {
    const emp = await _get('SELECT * FROM employees WHERE id = $1', [Number(id)]);
    if (!emp) return null;
    if (emp.status !== 'archived') return 'not_archived';
    await _run('DELETE FROM employees WHERE id = $1', [Number(id)]);
    return emp;
  },

  async deleteAllEmployees() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const count = await client.query('SELECT COUNT(*)::int cnt FROM employees');
      await client.query('DELETE FROM employees');
      await client.query('COMMIT');
      return count.rows[0].cnt;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async upsertEmployee(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const norm = normalizeName(data.name);
      let existing = await client.query('SELECT * FROM employees WHERE name_lower = $1 LIMIT 1', [norm]);
      if (!existing.rows[0] && data.email) {
        existing = await client.query("SELECT * FROM employees WHERE email = $1 AND email != '' LIMIT 1", [data.email]);
      }
      const now = new Date().toISOString();
      let result;
      if (existing.rows[0]) {
        const allowed = ['education','position','contacts','experience','about','competencies','project_experience','certification','email','city'];
        const p = { ...prepEmployee(existing.rows[0]), id: existing.rows[0].id };
        for (const k of allowed) {
          if (data[k] !== undefined) {
            p[k] = typeof data[k] === 'object' ? JSON.stringify(data[k]) : String(data[k] ?? '');
          }
        }
        p.updated_at = now;
        // Build update
        const cols = Object.keys(p).filter(k => k !== 'id' && k !== 'created_at');
        const setClauses = cols.map((k, i) => `${k} = $${i + 1}`);
        const vals = cols.map(k => p[k]);
        vals.push(p.id);
        await client.query(`UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${vals.length}`, vals);
        result = 'updated';
      } else {
        const p = { ...prepEmployee(data), created_at: now, updated_at: now };
        const cols = Object.keys(p);
        const vals = Object.values(p);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders})`, vals);
        result = 'inserted';
      }
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // Импорт "добавить/обновить": сопоставление СТРОГО по email.
  // Если сотрудник с таким email уже есть — обновляем его данными из файла
  // (значения из файла приоритетны и перекрывают старые; пустые поля файла
  // не затирают то, что уже было заполнено). Если email в файле пустой —
  // сопоставление по email невозможно, запись создаётся как новая.
  async upsertEmployeeByEmail(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const email = String(data.email || '').trim();
      let existing = { rows: [] };
      if (email) {
        existing = await client.query(
          "SELECT * FROM employees WHERE lower(email) = lower($1) AND email != '' LIMIT 1",
          [email]
        );
      }
      const now = new Date().toISOString();
      let result;
      if (existing.rows[0]) {
        const allowed = ['name','education','position','contacts','experience','about','competencies','project_experience','certification','email','city'];
        const p = { ...prepEmployee(existing.rows[0]), id: existing.rows[0].id, created_at: existing.rows[0].created_at };
        for (const k of allowed) {
          const incoming = data[k];
          const isEmpty = incoming === undefined || incoming === null ||
            (typeof incoming === 'string' && incoming.trim() === '') ||
            (Array.isArray(incoming) && incoming.length === 0);
          if (!isEmpty) {
            p[k] = typeof incoming === 'object' ? JSON.stringify(incoming) : String(incoming);
          }
        }
        if (data.name) p.name_lower = normalizeName(data.name);
        p.updated_at = now;
        const cols = Object.keys(p).filter(k => k !== 'id' && k !== 'created_at');
        const setClauses = cols.map((k, i) => `${k} = $${i + 1}`);
        const vals = cols.map(k => p[k]);
        vals.push(p.id);
        await client.query(`UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${vals.length}`, vals);
        result = { action: 'updated', id: p.id };
      } else {
        const p = { ...prepEmployee(data), created_at: now, updated_at: now };
        const cols = Object.keys(p);
        const vals = Object.values(p);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        const inserted = await client.query(
          `INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
          vals
        );
        result = { action: 'inserted', id: inserted.rows[0].id };
      }
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ── Должности ────────────────────────────────────────────────────────────────
  async getPositions() {
    const s = await loadSettings();
    return s.positions || [];
  },
  async addPosition(name) {
    const s = await loadSettings();
    if (!s.positions) s.positions = [];
    if (!s.positions.includes(name)) s.positions.push(name);
    await saveSettings(s);
    return s.positions;
  },
  async removePosition(name) {
    const s = await loadSettings();
    if (!s.positions) s.positions = [];
    s.positions = s.positions.filter(p => p !== name);
    await saveSettings(s);
    return s.positions;
  },

  // ── Изменения ────────────────────────────────────────────────────────────────
  async getPendingGrouped() {
    const all = await _all('SELECT * FROM pending_changes WHERE status = $1 ORDER BY submitted_at', ['pending']);
    const changes = all.filter(c => c.field_name !== 'courses' && c.field_name !== 'cert_date');
    const empIds = [...new Set(changes.map(c => c.employee_id))];
    const emps = {};
    for (const id of empIds) {
      const e = await _get('SELECT * FROM employees WHERE id = $1', [id]);
      if (e) emps[id] = e;
    }
    const grouped = {};
    for (const c of changes) {
      if (!grouped[c.employee_id]) {
        const emp = emps[c.employee_id] || {};
        grouped[c.employee_id] = {
          employee_id: c.employee_id,
          employee_name: emp.name || '?',
          employee_position: emp.position || '',
          employee_photo: emp.photo || '',
          changes: [],
        };
      }
      grouped[c.employee_id].changes.push(c);
    }
    return { count: Object.keys(grouped).length, groups: Object.values(grouped) };
  },

  getPendingByEmployee(employeeId) {
    return _all('SELECT * FROM pending_changes WHERE employee_id = $1 AND status = $2', [Number(employeeId), 'pending']);
  },

  async hasPendingForEmployee(employeeId) {
    const r = await _get("SELECT 1 as one FROM pending_changes WHERE employee_id = $1 AND status = 'pending' LIMIT 1", [Number(employeeId)]);
    return !!r;
  },

  async countPending() {
    const r = await _get("SELECT COUNT(DISTINCT employee_id)::int cnt FROM pending_changes WHERE status = 'pending'");
    return r ? r.cnt : 0;
  },

  getChangeById(id) {
    return _get('SELECT * FROM pending_changes WHERE id = $1', [Number(id)]).then(r => r || null);
  },

  getPendingChangesForEmployee(employeeId) {
    return _all('SELECT * FROM pending_changes WHERE employee_id = $1 AND status = $2', [Number(employeeId), 'pending']).then(r => r || []);
  },

  getReviewedChangesForEmployee(employeeId) {
    return _all("SELECT * FROM pending_changes WHERE employee_id = $1 AND status IN ('approved','rejected') AND reviewed_at != ''", [Number(employeeId)]);
  },

  async getApprovalHistory(limit = 500) {
    const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 500));
    const [items, totals] = await Promise.all([
      _all(`
        SELECT id, employee_id, employee_name, employee_position, field_name,
               old_value, new_value, submitted_at, reviewed_at, reviewed_by,
               decision_status, reject_reason, reverted_at, reverted_by,
               returned_to_pending_at, returned_to_pending_by
        FROM approval_history
        ORDER BY reviewed_at DESC, id DESC
        LIMIT $1
      `, [safeLimit]),
      _get(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE decision_status = 'approved' AND COALESCE(reverted_at, '') = '')::int AS active_count,
               COUNT(*) FILTER (WHERE COALESCE(reverted_at, '') <> '')::int AS reverted_count,
               COUNT(*) FILTER (WHERE decision_status = 'rejected' AND COALESCE(returned_to_pending_at, '') = '')::int AS rejected_count,
               COUNT(*) FILTER (WHERE COALESCE(returned_to_pending_at, '') <> '')::int AS returned_count,
               COUNT(DISTINCT employee_id)::int AS employee_count
        FROM approval_history
      `),
    ]);
    return {
      total: totals?.total || 0,
      activeCount: totals?.active_count || 0,
      revertedCount: totals?.reverted_count || 0,
      rejectedCount: totals?.rejected_count || 0,
      returnedCount: totals?.returned_count || 0,
      employeeCount: totals?.employee_count || 0,
      items,
    };
  },

  async revertApprovalHistory(historyId, reviewerName = '') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const historyResult = await client.query('SELECT * FROM approval_history WHERE id = $1 FOR UPDATE', [Number(historyId)]);
      const history = historyResult.rows[0];
      if (!history) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_found' }; }
      if (history.decision_status !== 'approved') { await client.query('ROLLBACK'); return { ok: false, reason: 'not_available' }; }
      if (history.reverted_at) { await client.query('ROLLBACK'); return { ok: false, reason: 'already_reverted' }; }
      if (!history.employee_id || !ALLOWED_FIELDS.has(history.field_name)) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_available' };
      }

      const employeeResult = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [Number(history.employee_id)]);
      const employee = employeeResult.rows[0];
      if (!employee) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_available' }; }

      const currentValue = employee[history.field_name] == null ? '' : String(employee[history.field_name]);
      const approvedValue = history.new_value == null ? '' : String(history.new_value);
      if (currentValue !== approvedValue) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'changed_after_approval' };
      }

      const restoredValue = history.old_value == null ? '' : String(history.old_value);
      const now = new Date().toISOString();
      await client.query(`UPDATE employees SET "${history.field_name}" = $1, updated_at = $2 WHERE id = $3`, [restoredValue, now, history.employee_id]);

      if (history.field_name === 'contacts') {
        const lines = restoredValue.split('\n').map(line => line.trim()).filter(Boolean);
        const email = lines.find(line => line.includes('@')) || '';
        await client.query('UPDATE employees SET city = $1, email = $2 WHERE id = $3', [lines[0] || '', email, history.employee_id]);
      }
      if (history.field_name === 'name') {
        await client.query('UPDATE employees SET name_lower = $1 WHERE id = $2', [normalizeName(restoredValue), history.employee_id]);
      }

      await client.query('UPDATE approval_history SET reverted_at = $1, reverted_by = $2 WHERE id = $3', [now, reviewerName, Number(historyId)]);
      await client.query("UPDATE pending_changes SET status = 'reverted' WHERE id = $1 AND status = 'approved'", [history.source_change_id]);
      await client.query('COMMIT');
      return { ok: true, revertedAt: now, revertedBy: reviewerName };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async returnHistoryToPending(historyId, reviewerName = '') {
    return helpers.decideApprovalHistory(historyId, 'pending', '', reviewerName);
  },

  async decideApprovalHistory(historyId, decision, reason = '', reviewerName = '') {
    if (!['approved', 'rejected', 'pending'].includes(decision)) {
      return { ok: false, reason: 'invalid_decision' };
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const historyResult = await client.query('SELECT * FROM approval_history WHERE id = $1 FOR UPDATE', [Number(historyId)]);
      const history = historyResult.rows[0];
      if (!history) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_found' }; }
      if (!history.employee_id || !ALLOWED_FIELDS.has(history.field_name)) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_available' };
      }

      const employeeResult = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [Number(history.employee_id)]);
      const employee = employeeResult.rows[0];
      if (!employee) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_available' }; }

      const currentValue = employee[history.field_name] == null ? '' : String(employee[history.field_name]);
      const oldValue = history.old_value == null ? '' : String(history.old_value);
      const proposedValue = history.new_value == null ? '' : String(history.new_value);
      const sourceResult = await client.query('SELECT * FROM pending_changes WHERE id = $1 FOR UPDATE', [Number(history.source_change_id)]);
      const sourceChange = sourceResult.rows[0] || null;

      if (decision === 'approved' && currentValue === proposedValue) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'already_approved' };
      }
      if (decision === 'rejected' && currentValue === oldValue && sourceChange?.status === 'rejected') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'already_rejected' };
      }
      if (decision === 'pending' && sourceChange?.status === 'pending') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'already_pending' };
      }
      if (currentValue !== oldValue && currentValue !== proposedValue) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'changed_after_decision' };
      }

      const otherPending = await client.query(
        "SELECT id FROM pending_changes WHERE employee_id = $1 AND field_name = $2 AND status = 'pending' AND id <> $3 LIMIT 1",
        [Number(history.employee_id), history.field_name, Number(history.source_change_id)]
      );
      if (otherPending.rows[0]) { await client.query('ROLLBACK'); return { ok: false, reason: 'already_pending' }; }

      const now = new Date().toISOString();
      const resultingValue = decision === 'approved' ? proposedValue : oldValue;
      if (currentValue !== resultingValue) {
        await client.query(`UPDATE employees SET "${history.field_name}" = $1, updated_at = $2 WHERE id = $3`, [resultingValue, now, history.employee_id]);
        if (history.field_name === 'contacts') {
          const lines = resultingValue.split('\n').map(line => line.trim()).filter(Boolean);
          const email = lines.find(line => line.includes('@')) || '';
          await client.query('UPDATE employees SET city = $1, email = $2 WHERE id = $3', [lines[0] || '', email, history.employee_id]);
        }
        if (history.field_name === 'name') {
          await client.query('UPDATE employees SET name_lower = $1 WHERE id = $2', [normalizeName(resultingValue), history.employee_id]);
        }
      }

      let sourceChangeId = sourceChange?.id;
      const pendingStatus = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'pending';
      if (sourceChange) {
        await client.query(`
          UPDATE pending_changes
          SET old_value = $1, new_value = $2, submitted_at = $3, status = $4,
              reviewed_at = $5, reviewed_by = $6, reject_reason = $7
          WHERE id = $8
        `, [oldValue, proposedValue, now, pendingStatus,
          decision === 'pending' ? '' : now,
          decision === 'pending' ? '' : reviewerName,
          decision === 'rejected' ? reason : '', sourceChangeId]);
      } else {
        const inserted = await client.query(`
          INSERT INTO pending_changes (employee_id, field_name, old_value, new_value, submitted_at, status, reviewed_at, reviewed_by, reject_reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [Number(history.employee_id), history.field_name, oldValue, proposedValue, now, pendingStatus,
          decision === 'pending' ? '' : now,
          decision === 'pending' ? '' : reviewerName,
          decision === 'rejected' ? reason : '']);
        sourceChangeId = inserted.rows[0].id;
      }

      if (decision !== 'approved') {
        await client.query(`
          UPDATE approval_history
          SET reverted_at = $1, reverted_by = $2
          WHERE decision_status = 'approved' AND COALESCE(reverted_at, '') = ''
            AND employee_id = $3 AND field_name = $4 AND new_value = $5
        `, [now, reviewerName, Number(history.employee_id), history.field_name, proposedValue]);
      }

      await client.query(`
        INSERT INTO approval_history (
          source_change_id, employee_id, employee_name, employee_position,
          field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by,
          decision_status, reject_reason, returned_to_pending_at, returned_to_pending_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [sourceChangeId, Number(history.employee_id), history.employee_name || employee.name || '',
        history.employee_position || employee.position || '', history.field_name, oldValue, proposedValue,
        history.submitted_at || now, now, reviewerName, decision, decision === 'rejected' ? reason : '',
        decision === 'pending' ? now : '', decision === 'pending' ? reviewerName : '']);

      await client.query('COMMIT');
      return {
        ok: true,
        decision,
        pendingChangeId: sourceChangeId,
        reviewedAt: now,
        reviewedBy: reviewerName,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  countPendingForEmployee(employeeId) {
    return _get("SELECT COUNT(*)::int cnt FROM pending_changes WHERE employee_id = $1 AND status = 'pending'", [Number(employeeId)]).then(r => r ? r.cnt : 0);
  },

  async submitChanges(employeeId, changesArray) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM pending_changes WHERE employee_id = $1 AND status IN ('pending','approved','rejected','reverted')", [Number(employeeId)]);
      const now = new Date().toISOString();
      for (const ch of changesArray) {
        await client.query(
          "INSERT INTO pending_changes (employee_id, field_name, old_value, new_value, submitted_at, status) VALUES ($1, $2, $3, $4, $5, 'pending')",
          [Number(employeeId), ch.field_name || '', ch.old_value || '', ch.new_value || '', now]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async approveChange(changeId, reviewerName = '') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = await client.query('SELECT * FROM pending_changes WHERE id = $1', [Number(changeId)]);
      if (!ch.rows[0] || ch.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return false; }
      const change = ch.rows[0];
      const now = new Date().toISOString();
      const emp = await client.query('SELECT * FROM employees WHERE id = $1', [change.employee_id]);
      if (emp.rows[0] && change.field_name === 'total_experience') {
        let experience = {};
        try { experience = JSON.parse(emp.rows[0].experience || '{}'); } catch {}
        experience = { ...(experience && typeof experience === 'object' ? experience : {}), total: change.new_value || '' };
        await client.query('UPDATE employees SET experience = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(experience), now, change.employee_id]);
      } else if (emp.rows[0] && ALLOWED_FIELDS.has(change.field_name)) {
        await client.query(`UPDATE employees SET "${change.field_name}" = $1, updated_at = $2 WHERE id = $3`, [change.new_value, now, change.employee_id]);
        if (change.field_name === 'contacts') {
          const lines = (change.new_value || '').split('\n').filter(l => l.trim());
          if (lines[0]) await client.query('UPDATE employees SET city = $1 WHERE id = $2', [lines[0], change.employee_id]);
          const email = lines.find(l => l.includes('@'));
          if (email) await client.query('UPDATE employees SET email = $1 WHERE id = $2', [email, change.employee_id]);
        }
      }
      await client.query(`
        INSERT INTO approval_history (
          source_change_id, employee_id, employee_name, employee_position,
          field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by
        )
        SELECT pc.id, pc.employee_id, COALESCE(e.name, ''), COALESCE(e.position, ''),
               pc.field_name, pc.old_value, pc.new_value, pc.submitted_at, $1, $2
        FROM pending_changes pc
        LEFT JOIN employees e ON e.id = pc.employee_id
        WHERE pc.id = $3
      `, [now, reviewerName, Number(changeId)]);
      await client.query("UPDATE pending_changes SET status = 'approved', reviewed_at = $1, reviewed_by = $2 WHERE id = $3", [now, reviewerName, Number(changeId)]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async rejectChange(changeId, reason = '', reviewerName = '') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const changeResult = await client.query("SELECT * FROM pending_changes WHERE id = $1 AND status = 'pending' FOR UPDATE", [Number(changeId)]);
      if (!changeResult.rows[0]) { await client.query('ROLLBACK'); return false; }
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO approval_history (
          source_change_id, employee_id, employee_name, employee_position,
          field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by,
          decision_status, reject_reason
        )
        SELECT pc.id, pc.employee_id, COALESCE(e.name, ''), COALESCE(e.position, ''),
               pc.field_name, pc.old_value, pc.new_value, pc.submitted_at, $1, $2,
               'rejected', $3
        FROM pending_changes pc
        LEFT JOIN employees e ON e.id = pc.employee_id
        WHERE pc.id = $4
      `, [now, reviewerName, reason, Number(changeId)]);
      await client.query("UPDATE pending_changes SET status = 'rejected', reviewed_at = $1, reviewed_by = $2, reject_reason = $3 WHERE id = $4",
        [now, reviewerName, reason, Number(changeId)]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async approveAllForEmployee(employeeId, reviewerName = '') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const changes = await client.query('SELECT * FROM pending_changes WHERE employee_id = $1 AND status = $2', [Number(employeeId), 'pending']);
      const now = new Date().toISOString();
      const emp = await client.query('SELECT * FROM employees WHERE id = $1', [Number(employeeId)]);
      if (emp.rows[0]) {
        for (const ch of changes.rows) {
          if (ch.field_name === 'total_experience') {
            let experience = {};
            try { experience = JSON.parse(emp.rows[0].experience || '{}'); } catch {}
            experience = { ...(experience && typeof experience === 'object' ? experience : {}), total: ch.new_value || '' };
            await client.query('UPDATE employees SET experience = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(experience), now, ch.employee_id]);
            emp.rows[0].experience = JSON.stringify(experience);
          } else if (ALLOWED_FIELDS.has(ch.field_name)) {
            await client.query(`UPDATE employees SET "${ch.field_name}" = $1, updated_at = $2 WHERE id = $3`, [ch.new_value, now, ch.employee_id]);
            if (ch.field_name === 'contacts') {
              const lines = (ch.new_value || '').split('\n').filter(l => l.trim());
              if (lines[0]) await client.query('UPDATE employees SET city = $1 WHERE id = $2', [lines[0], ch.employee_id]);
              const email = lines.find(l => l.includes('@'));
              if (email) await client.query('UPDATE employees SET email = $1 WHERE id = $2', [email, ch.employee_id]);
            }
          }
        }
      }
      await client.query(`
        INSERT INTO approval_history (
          source_change_id, employee_id, employee_name, employee_position,
          field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by
        )
        SELECT pc.id, pc.employee_id, COALESCE(e.name, ''), COALESCE(e.position, ''),
               pc.field_name, pc.old_value, pc.new_value, pc.submitted_at, $1, $2
        FROM pending_changes pc
        LEFT JOIN employees e ON e.id = pc.employee_id
        WHERE pc.employee_id = $3 AND pc.status = 'pending'
      `, [now, reviewerName, Number(employeeId)]);
      await client.query("UPDATE pending_changes SET status = 'approved', reviewed_at = $1, reviewed_by = $2 WHERE employee_id = $3 AND status = 'pending'",
        [now, reviewerName, Number(employeeId)]);
      await client.query('COMMIT');
      return changes.rows.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async rejectAllForEmployee(employeeId, reason = '', reviewerName = '') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const changes = await client.query("SELECT id FROM pending_changes WHERE employee_id = $1 AND status = 'pending' FOR UPDATE", [Number(employeeId)]);
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO approval_history (
          source_change_id, employee_id, employee_name, employee_position,
          field_name, old_value, new_value, submitted_at, reviewed_at, reviewed_by,
          decision_status, reject_reason
        )
        SELECT pc.id, pc.employee_id, COALESCE(e.name, ''), COALESCE(e.position, ''),
               pc.field_name, pc.old_value, pc.new_value, pc.submitted_at, $1, $2,
               'rejected', $3
        FROM pending_changes pc
        LEFT JOIN employees e ON e.id = pc.employee_id
        WHERE pc.employee_id = $4 AND pc.status = 'pending'
      `, [now, reviewerName, reason, Number(employeeId)]);
      await client.query("UPDATE pending_changes SET status = 'rejected', reviewed_at = $1, reviewed_by = $2, reject_reason = $3 WHERE employee_id = $4 AND status = 'pending'",
        [now, reviewerName, reason, Number(employeeId)]);
      await client.query('COMMIT');
      return changes.rowCount;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getStats() {
    const empCount = await _get("SELECT COUNT(*)::int cnt FROM employees WHERE status = 'active'");
    const pendingCount = await _get("SELECT COUNT(DISTINCT employee_id)::int cnt FROM pending_changes WHERE status = 'pending'");
    const approvedCount = await _get("SELECT COUNT(*)::int cnt FROM approval_history WHERE decision_status = 'approved' AND COALESCE(reverted_at, '') = ''");
    return { total: empCount.cnt, pending: pendingCount.cnt, approved: approvedCount.cnt };
  },

  // ── Projects ────────────────────────────────────────────────────────────────
  getProjectLeaders() {
    return _all("SELECT id, name, email FROM employees WHERE status = 'active' AND is_rp = TRUE ORDER BY name_lower");
  },

  async getAllProjects() {
    const projects = await _all(`
      SELECT p.*,
             e.name AS leader_employee_name
      FROM projects p
      LEFT JOIN employees e ON e.id = p.leader_employee_id
      ORDER BY p.created_at DESC, p.id DESC
    `).then(castProjects);
    return withProjectDateChecks(await withActiveProjectMembers(projects));
  },

  async getProjectById(id) {
    const project = await _get(`
      SELECT p.*,
             e.name AS leader_employee_name
      FROM projects p
      LEFT JOIN employees e ON e.id = p.leader_employee_id
      WHERE p.id = $1
    `, [Number(id)]).then(castProject);
    return withProjectDateChecks(await withActiveProjectMembers(project));
  },

  async createProject({ title, leaderEmployeeId, status }) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('Название проекта обязательно');

    const leader = leaderEmployeeId ? await helpers.getEmployee(Number(leaderEmployeeId)) : null;
    if (!leader) throw new Error('Выберите руководителя из списка');
    if (!leader.is_rp) throw new Error('Выбранный сотрудник не отмечен как РП');

    const now = new Date().toISOString();
    return _get(
      `INSERT INTO projects (title, status, leader_employee_id, leader_name, customer, description, start_period, end_period, team_size, technologies, team_members, created_at, updated_at, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, title, status, customer, description, start_period, end_period, team_size, technologies, team_members, leader_employee_id, leader_name, created_at, updated_at, sent_at`,
      [cleanTitle, status || 'Черновик', leader.id, leader.name, '', '', '', '', 0, '', '[]', now, now, '']
    );
  },

  async updateProject(id, fields) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const project = await client.query('SELECT * FROM projects WHERE id = $1', [Number(id)]);
      if (!project.rows[0]) { await client.query('ROLLBACK'); return null; }
      const current = project.rows[0];
      const preparedFields = { ...fields };
      if (preparedFields.description !== undefined || preparedFields.functional_blocks !== undefined) {
        let blocks = preparedFields.functional_blocks;
        if (!Array.isArray(blocks)) {
          try { blocks = JSON.parse(current.functional_blocks || '[]'); } catch { blocks = []; }
        }
        preparedFields.description = composeProjectDescription(
          preparedFields.description !== undefined ? preparedFields.description : current.description,
          blocks
        );
      }
      if (preparedFields.team_members !== undefined) {
        const submittedMembers = Array.isArray(preparedFields.team_members) ? preparedFields.team_members : [];
        const submittedIds = [...new Set(submittedMembers.map(member => Number(member?.employee_id || member?.id || 0)).filter(Boolean))];
        const activeRows = submittedIds.length
          ? await client.query("SELECT id, name FROM employees WHERE id = ANY($1::int[]) AND status = 'active'", [submittedIds])
          : { rows: [] };
        const activeEmployees = new Map(activeRows.rows.map(employee => [Number(employee.id), employee.name]));
        const acceptedEmployeeIds = new Set();
        preparedFields.team_members = submittedMembers.filter(member => {
          const employeeId = Number(member?.employee_id || member?.id || 0);
          if (!employeeId || !activeEmployees.has(employeeId) || acceptedEmployeeIds.has(employeeId)) return false;
          acceptedEmployeeIds.add(employeeId);
          return true;
        }).map(member => {
          const employeeId = Number(member.employee_id || member.id);
          return { ...member, employee_id: employeeId, employee_name: activeEmployees.get(employeeId) };
        });
      }
      if (preparedFields.leader_employee_id !== undefined) {
        const leaderId = Number(preparedFields.leader_employee_id || 0);
        if (!leaderId) {
          preparedFields.leader_employee_id = null;
          preparedFields.leader_name = '';
        } else {
          const leader = await client.query("SELECT id, name, is_rp, status FROM employees WHERE id = $1", [leaderId]);
          if (!leader.rows[0] || leader.rows[0].status === 'archived') throw new Error('Выбранный руководитель не найден');
          if (!leader.rows[0].is_rp) throw new Error('Выбранный сотрудник не отмечен как РП');
          preparedFields.leader_employee_id = leader.rows[0].id;
          preparedFields.leader_name = leader.rows[0].name;
        }
      }
      const allowed = ['title','status','customer','code_name','legal_customer_name','industry_description','description','start_period','end_period','end_present','team_size','technologies','functional_area','functional_blocks','team_members','leader_employee_id','leader_name'];
      const updates = [];
      const params = [Number(id)];
      let idx = 2;
      for (const key of allowed) {
        if (preparedFields[key] === undefined) continue;
        let value = preparedFields[key];
        if (key === 'team_members' || key === 'functional_blocks') value = JSON.stringify(Array.isArray(value) ? value : []);
        if (key === 'team_size') value = Math.max(0, Number(value || 0));
        if (key === 'end_present') value = !!value;
        updates.push(`${key} = $${idx}`);
        params.push(value);
        idx++;
      }
      updates.push(`updated_at = $${idx}`);
      params.push(new Date().toISOString());
      if (updates.length === 1) {
        await client.query('COMMIT');
        return current;
      }
      await client.query(`UPDATE projects SET ${updates.join(', ')} WHERE id = $1`, params);
      const updated = await client.query('SELECT * FROM projects WHERE id = $1', [Number(id)]);
      await client.query('COMMIT');
      return castProject(updated.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async createProjects(projects) {
    if (!Array.isArray(projects) || projects.length === 0) return [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = [];
      for (const project of projects) {
        const title = String(project?.title || '').trim();
        if (!title) continue;
        const leaderId = project?.leaderEmployeeId ? Number(project.leaderEmployeeId) : null;
        if (!leaderId) throw new Error(`Для проекта «${title}» не выбран руководитель`);
        const leader = await client.query("SELECT id, name, is_rp FROM employees WHERE id = $1", [leaderId]);
        const manager = leader.rows[0];
        if (!manager) throw new Error(`Руководитель для проекта «${title}» не найден`);
        if (!manager.is_rp) throw new Error(`Пользователь «${manager.name}» не отмечен как РП`);
        const now = new Date().toISOString();
        const result = await client.query(
          `INSERT INTO projects (title, status, leader_employee_id, leader_name, created_at, updated_at, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, title, status, leader_employee_id, leader_name, created_at, updated_at, sent_at`,
          [title, project.status || 'Черновик', leaderId, manager.name, now, now, '']
        );
        inserted.push(result.rows[0]);
      }
      await client.query('COMMIT');
      return inserted;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async importProjectExperience(parsed) {
    if (!parsed || !Array.isArray(parsed.projects)) throw new Error('Некорректные данные импорта');
    const client = await pool.connect();
    const affectedProjectIds = [];
    let employeesCreated = 0, employeesUpdated = 0, employeesArchived = 0;
    let projectsCreated = 0, projectsUpdated = 0;
    try {
      await client.query('BEGIN');
      const people = new Map();
      for (const project of parsed.projects) {
        for (const member of project.members || []) {
          const key = normalizeName(member.name);
          if (!people.has(key)) people.set(key, { name: member.name });
        }
      }
      const employeeIds = new Map();
      for (const [key, person] of people.entries()) {
        const existing = await client.query('SELECT * FROM employees WHERE name_lower = $1 LIMIT 1', [key]);
        if (existing.rows[0]) {
          await client.query("UPDATE employees SET status = 'active', updated_at = $1 WHERE id = $2", [new Date().toISOString(), existing.rows[0].id]);
          employeeIds.set(key, existing.rows[0].id);
          employeesUpdated += 1;
        } else {
          const prepared = prepEmployee({ name: person.name, status: 'active' });
          const columns = Object.keys(prepared);
          const result = await client.query(`INSERT INTO employees (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`, Object.values(prepared));
          employeeIds.set(key, result.rows[0].id);
          employeesCreated += 1;
        }
      }
      for (const name of parsed.inactiveEmployees || []) {
        if (people.has(normalizeName(name))) continue;
        const result = await client.query("UPDATE employees SET status = 'archived', updated_at = $1 WHERE name_lower = $2 AND status <> 'archived'", [new Date().toISOString(), normalizeName(name)]);
        employeesArchived += result.rowCount;
      }
      for (const imported of parsed.projects) {
        const members = (imported.members || []).map(member => ({
          employee_id: employeeIds.get(normalizeName(member.name)) || null,
          employee_name: member.name,
          role: member.role || member.position || '',
          participation_start: member.participationStart || '',
          participation_end: member.participationEnd || '',
          functional_areas: member.functionalAreas || [],
          technologies: member.technologies || [],
        })).filter(member => member.employee_id);
        const current = await client.query('SELECT * FROM projects WHERE LOWER(TRIM(title)) = LOWER(TRIM($1)) ORDER BY id LIMIT 1', [imported.title]);
        const now = new Date().toISOString();
        const values = [imported.title, imported.description || '', imported.startPeriod || '', imported.endPeriod || '', Number(imported.fullTeamSize || members.length), (imported.technologies || []).join(', '), imported.functionalArea || '', JSON.stringify(members), JSON.stringify(imported.sourceRows || []), now];
        let projectId;
        if (current.rows[0]) {
          projectId = current.rows[0].id;
          await client.query(`UPDATE projects SET title=$1, description=CASE WHEN source_system='УПП' AND description LIKE 'Функциональные области:%' THEN $2 ELSE COALESCE(NULLIF($2, ''), description) END, start_period=$3, end_period=$4, team_size=$5, technologies=$6, functional_area=$7, team_members=$8, source_system='УПП', source_data=$9, updated_at=$10 WHERE id=$11`, [...values, projectId]);
          projectsUpdated += 1;
        } else {
          const result = await client.query(`INSERT INTO projects (title, status, description, start_period, end_period, team_size, technologies, functional_area, team_members, source_system, source_data, created_at, updated_at, sent_at) VALUES ($1, 'Черновик', $2, $3, $4, $5, $6, $7, $8, 'УПП', $9, $10, $10, '') RETURNING id`, values);
          projectId = result.rows[0].id;
          projectsCreated += 1;
        }
        affectedProjectIds.push(projectId);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const affectedProjects = await helpers.getProjectsByIds(affectedProjectIds);
    for (const project of affectedProjects) await helpers.syncProjectTeamMembers(project);
    return { employeesCreated, employeesUpdated, employeesArchived, projectsCreated, projectsUpdated, projects: affectedProjects.length };
  },

  async getProjectFunctionalBlocks() {
    const rows = await _all("SELECT functional_blocks, functional_area FROM projects WHERE (functional_blocks IS NOT NULL AND functional_blocks <> '') OR (functional_area IS NOT NULL AND functional_area <> '')");
    const values = new Set();
    for (const row of rows) {
      let blocks = [];
      try { blocks = JSON.parse(row.functional_blocks || '[]'); } catch { blocks = []; }
      for (const block of blocks) if (String(block || '').trim()) values.add(String(block).trim());
      for (const area of String(row.functional_area || '').split(/[,;\n]/)) if (area.trim()) values.add(area.trim());
    }
    return [...values].sort((a, b) => a.localeCompare(b, 'ru'));
  },

  async getProjectsForLeaderEmployee(employeeId) {
    const rows = await _all(`
      SELECT p.*, e.name AS leader_employee_name
      FROM projects p
      LEFT JOIN employees e ON e.id = p.leader_employee_id
      WHERE p.leader_employee_id = $1
      ORDER BY p.created_at DESC, p.id DESC
    `, [Number(employeeId)]);

    const allIds = [];
    const parsed = rows.map(row => {
      row = castProject(row);
      row.team_members.forEach(m => {
        const id = Number(m.employee_id || m.id || 0);
        if (id) allIds.push(id);
      });
      return row;
    });

    const memberRows = await helpers.getEmployeesByIds([...new Set(allIds)]);
    const memberMap = new Map(memberRows.map(m => [Number(m.id), m.name]));

    const projects = parsed.map(row => ({
      ...row,
      team_members: (row.team_members || []).map(m => {
        const id = Number(m.employee_id || m.id || 0);
        return { ...m, employee_id: id, employee_name: memberMap.get(id) || m.employee_name || m.name || '' };
      }).filter(member => memberMap.has(Number(member.employee_id))),
    }));
    return withProjectDateChecks(projects);
  },

  async syncProjectTeamMembers(project) {
    if (!project || !project.id) return [];
    const submittedMembers = Array.isArray(project.team_members) ? project.team_members : [];
    const submittedIds = [...new Set(submittedMembers.map(member => Number(member.employee_id || member.id || 0)).filter(Boolean))];
    const activeRows = submittedIds.length
      ? await _all("SELECT id FROM employees WHERE id = ANY($1::int[]) AND status = 'active'", [submittedIds])
      : [];
    const activeIds = new Set(activeRows.map(employee => Number(employee.id)));
    const members = submittedMembers.filter(member => activeIds.has(Number(member.employee_id || member.id || 0)));
    const memberIds = new Set(members.map(member => Number(member.employee_id || member.id || 0)).filter(Boolean));
    const employees = await _all('SELECT id, project_experience FROM employees');
    for (const employee of employees) {
      if (memberIds.has(Number(employee.id))) continue;
      let experience = [];
      try { experience = JSON.parse(employee.project_experience || '[]'); } catch { experience = parseLegacyProject(employee.project_experience); }
      if (!Array.isArray(experience)) continue;
      const filtered = experience.filter(item => Number(item?.project_id || 0) !== Number(project.id));
      if (filtered.length !== experience.length) await _run('UPDATE employees SET project_experience = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(filtered), new Date().toISOString(), employee.id]);
    }
    const synced = [];
    const projectBlocks = Array.isArray(project.functional_blocks) ? project.functional_blocks : [];
    for (const member of members) {
      const employeeId = Number(member.employee_id || member.id || 0);
      if (!employeeId) continue;
      const updated = await helpers.syncEmployeeProjectExperience(employeeId, {
        project_id: project.id,
        period: [project.start_period || '', project.end_present ? 'настоящее время' : (project.end_period || '')].filter(Boolean).join(' - '),
        project_name: project.code_name || project.title,
        position: '',
        role: member.role || member.position || '',
        team_size: project.team_size,
        client: project.industry_description || project.legal_customer_name || project.customer || '',
        project_description: composeProjectDescription(project.description, projectBlocks),
        task_description: '',
        functional_area: Array.isArray(member.functional_areas) && member.functional_areas.length
          ? member.functional_areas.join(', ')
          : (project.functional_area || ''),
        technologies: project.technologies || '',
        functional_blocks: projectBlocks,
      });
      if (updated) synced.push(updated);
    }
    return synced;
  },

  async archiveProjects(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const res = await _run(
      `UPDATE projects
       SET status = 'Архив', updated_at = $1
       WHERE id = ANY($2::int[])`,
      [new Date().toISOString(), ids.map(Number)]
    );
    return res ? res.rowCount : 0;
  },

  async saveFeedback(employeeId, rating, comment) {
    await _run('DELETE FROM employee_feedback WHERE employee_id = $1', [Number(employeeId)]);
    return _run('INSERT INTO employee_feedback (employee_id, rating, comment, submitted_at) VALUES ($1, $2, $3, $4)',
      [Number(employeeId), rating || null, comment || '', new Date().toISOString()]);
  },

  getAllFeedback() {
    return _all(`    SELECT f.id, f.employee_id, e.name AS employee_name, e.position, f.rating, f.comment, f.submitted_at
      FROM employee_feedback f JOIN employees e ON f.employee_id = e.id ORDER BY f.submitted_at DESC`);
  },

  // ── Менеджеры ────────────────────────────────────────────────────────────────
  getManagerByLogin(email) {
    return _get('SELECT * FROM managers WHERE email = $1', [String(email).trim().toLowerCase()]);
  },
  getManagerById(id) {
    return _get('SELECT * FROM managers WHERE id = $1', [Number(id)]);
  },
  getAllManagers() {
    return _all(`
      SELECT m.id, m.name, m.email, m.role, m.employee_id, m.created_at,
             e.name AS employee_name
      FROM managers m
      LEFT JOIN employees e ON e.id = m.employee_id
      ORDER BY m.name
    `);
  },

  async restoreProjects(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const res = await _run(
      `UPDATE projects SET status = 'Черновик', updated_at = $1
       WHERE id = ANY($2::int[]) AND status = 'Архив'`,
      [new Date().toISOString(), ids.map(Number)]
    );
    return res ? res.rowCount : 0;
  },

  async createManager(name, email, passwordHash, role) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = await client.query('SELECT * FROM managers WHERE email = $1', [normalizedEmail]);
      if (existing.rows[0]) throw new Error('Менеджер с такой почтой уже существует');
      const validRoles = ['admin', 'scrum', 'leader'];
      const managerRole = validRoles.includes(role) ? role : 'scrum';
      let linkedEmployeeId = null;
      if (managerRole === 'leader') {
        const employee = await findEmployeeProfileForLeader(client, name, normalizedEmail);
        linkedEmployeeId = employee.id;
        await client.query('UPDATE employees SET is_rp = TRUE, updated_at = $1 WHERE id = $2', [new Date().toISOString(), linkedEmployeeId]);
      }
      const result = await client.query(
        'INSERT INTO managers (name, email, password_hash, role, employee_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [String(name || '').trim(), normalizedEmail, passwordHash, managerRole, linkedEmployeeId, new Date().toISOString()]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  updateManagerEmail(id, email) {
    return _run('UPDATE managers SET email = $1 WHERE id = $2', [String(email).trim().toLowerCase(), Number(id)]);
  },

  async deleteManager(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query('SELECT id, role, employee_id FROM managers WHERE id = $1 FOR UPDATE', [Number(id)]);
      if (!target.rows[0]) throw new Error('Пользователь не найден');
      const count = await client.query('SELECT COUNT(*)::int cnt FROM managers');
      if (count.rows[0].cnt <= 1) throw new Error('Нельзя удалить последнего менеджера');
      if (target.rows[0].role === 'admin') {
        const adminCount = await client.query("SELECT COUNT(*)::int cnt FROM managers WHERE role = 'admin'");
        if (adminCount.rows[0].cnt <= 1) throw new Error('Нельзя удалить последнего главного администратора');
      }
      await client.query('DELETE FROM managers WHERE id = $1', [Number(id)]);
      if (target.rows[0].role === 'leader' && target.rows[0].employee_id) {
        await client.query('UPDATE employees SET is_rp = FALSE, updated_at = $1 WHERE id = $2', [new Date().toISOString(), target.rows[0].employee_id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  updateManagerPassword(id, newHash) {
    return _run('UPDATE managers SET password_hash = $1 WHERE id = $2', [newHash, Number(id)]);
  },

  async updateManagerRole(id, role) {
    const validRoles = ['admin', 'scrum', 'leader'];
    if (!validRoles.includes(role)) throw new Error('Неверная роль');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query('SELECT id, name, role, email, employee_id FROM managers WHERE id = $1 FOR UPDATE', [Number(id)]);
      if (!target.rows[0]) throw new Error('Пользователь не найден');
      if (target.rows[0].role === 'admin' && role !== 'admin') {
        const adminCount = await client.query("SELECT COUNT(*)::int cnt FROM managers WHERE role = 'admin'");
        if (adminCount.rows[0].cnt <= 1) throw new Error('Нельзя снять роль у последнего главного администратора');
      }
      let employeeId = target.rows[0].employee_id;
      if (role === 'leader' && !employeeId) {
        const employee = await findEmployeeProfileForLeader(client, target.rows[0].name, target.rows[0].email, target.rows[0].id);
        employeeId = employee.id;
        await client.query('UPDATE employees SET is_rp = TRUE, updated_at = $1 WHERE id = $2', [new Date().toISOString(), employeeId]);
      }
      if (role !== 'leader') {
        if (target.rows[0].role === 'leader' && employeeId) {
          await client.query('UPDATE employees SET is_rp = FALSE, updated_at = $1 WHERE id = $2', [new Date().toISOString(), employeeId]);
        }
        employeeId = null;
      }
      await client.query('UPDATE managers SET role = $1, employee_id = $2 WHERE id = $3', [role, employeeId, Number(id)]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // ── Компетенции по должностям ──────────────────────────────────────────────
  getPositionCompetencies() {
    return helpers.getSetting('position_competencies').then(val => {
      try { return JSON.parse(val || '{}'); } catch { return {}; }
    });
  },
  setPositionCompetencies(obj) {
    return helpers.setSetting('position_competencies', JSON.stringify(obj));
  },
  async addPositionCompetency(position, competency) {
    const all = await helpers.getPositionCompetencies();
    if (!all[position]) all[position] = [];
    if (!all[position].includes(competency)) all[position].push(competency);
    await helpers.setPositionCompetencies(all);
    return all[position];
  },
  async removePositionCompetency(position, competency) {
    const all = await helpers.getPositionCompetencies();
    if (all[position]) {
      all[position] = all[position].filter(c => c !== competency);
      if (all[position].length === 0) delete all[position];
    }
    await helpers.setPositionCompetencies(all);
    return all[position] || [];
  },

  // ── Уникальные значения для фильтров ──────────────────────────────────────
  async getFilterData() {
    const rows = await _all("SELECT position, city, certification FROM employees WHERE status = 'active'");
    const positions = new Set();
    const cities = new Set();
    const certs = new Set();
    for (const r of rows) {
      if (r.position) positions.add(r.position);
      if (r.city) cities.add(r.city);
      if (r.certification) {
        const lines = r.certification.split(/\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const cleaned = line.replace(/^[-•]\s*/, '').replace(/^Сертификация 1С:?\s*/i, '').trim();
          if (cleaned && !cleaned.startsWith('Обучающие курсы') && cleaned !== '-') {
            certs.add(cleaned);
          }
        }
      }
    }
    return {
      positions: [...positions].sort(),
      cities: [...cities].sort(),
      certifications: [...certs].sort(),
    };
  },
};

// ─── Session helpers (для index.js) ──────────────────────────────────────────
const sessions = {
  get(sid) {
    return _get('SELECT sess FROM sessions WHERE sid = $1 AND expired > $2', [sid, Date.now()]);
  },
  set(sid, session, maxAge) {
    return _run('INSERT INTO sessions (sid, expired, sess) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET expired = $2, sess = $3',
      [sid, Date.now() + maxAge, JSON.stringify(session)]);
  },
  destroy(sid) {
    return _run('DELETE FROM sessions WHERE sid = $1', [sid]);
  },
  destroyForManager(managerId) {
    return _run("DELETE FROM sessions WHERE NULLIF(sess::jsonb ->> 'managerId', '')::int = $1", [Number(managerId)]);
  },
  touch(sid, maxAge) {
    return _run('UPDATE sessions SET expired = $1 WHERE sid = $2', [Date.now() + maxAge, sid]);
  },
};

// ─── Запуск инициализации ─────────────────────────────────────────────────────
let initPromise = init();

module.exports = { helpers, FIELD_LABELS, pool, sessions, initPromise };
