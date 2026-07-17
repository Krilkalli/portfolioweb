const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const config = require('./config');

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
    token TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_employees_token ON employees(token);
  CREATE INDEX IF NOT EXISTS idx_employees_name_lower ON employees(name_lower);
  CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

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
  CREATE INDEX IF NOT EXISTS idx_changes_status ON pending_changes(status);
  CREATE INDEX IF NOT EXISTS idx_changes_employee ON pending_changes(employee_id);

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
  CREATE INDEX IF NOT EXISTS idx_feedback_employee ON employee_feedback(employee_id);

  CREATE TABLE IF NOT EXISTS managers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT,
    role TEXT DEFAULT 'admin'
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
    token: emp.token || uuidv4(),
    status: emp.status === 'archived' ? 'archived' : 'active',
    created_at: emp.created_at || now,
    updated_at: now,
  };
}

// ─── Настройки ────────────────────────────────────────────────────────────────
async function loadSettings() {
  const rows = await _all('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  try { s.positions = s.positions ? JSON.parse(s.positions) : []; } catch { s.positions = []; }
  return s;
}

async function saveSettings(obj) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, v] of Object.entries(obj)) {
      const val = k === 'positions' ? JSON.stringify(v) : String(v ?? '');
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
  await _run("ALTER TABLE pending_changes ADD COLUMN IF NOT EXISTS reviewed_by TEXT DEFAULT ''").catch(() => {});
  await _run("ALTER TABLE managers ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'").catch(() => {});

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
  if (!settings.positions || !Array.isArray(settings.positions) || settings.positions.length === 0) {
    settings.positions = ['Стажер-консультант по внедрению 1С','Младший консультант по внедрению 1С','Консультант по внедрению 1С','Старший консультант по внедрению 1С','Ведущий консультант по внедрению 1С','Эксперт-консультант по внедрению 1С'];
    changed = true;
  }
  if (changed) await saveSettings(settings);

  // Миграция: переименовать 'Аналитик' → 'Консультант' в компетенциях
  const oldComps = helpers.getPositionCompetencies();
  if (oldComps['Аналитик'] !== undefined && oldComps['Консультант'] === undefined) {
    oldComps['Консультант'] = oldComps['Аналитик'];
    delete oldComps['Аналитик'];
    helpers.setPositionCompetencies(oldComps);
    console.log('✅ Компетенции: группа «Аналитик» переименована в «Консультант»');
  }

  // Seed компетенций по умолчанию
  const comps = helpers.getPositionCompetencies();
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
    const hash = settings.manager_password_hash || bcrypt.hashSync(config.defaultManagerPassword, 10);
    const login = 'admin';
    await _run(
      'INSERT INTO managers (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
      ['Главный администратор', login, hash, 'admin', new Date().toISOString()]
    );
    console.log(`✅ Создан менеджер по умолчанию: ${login}`);
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
    return _get('SELECT value FROM settings WHERE key = $1', [key]).then(r => r ? r.value : '');
  },
  setSetting(key, value) {
    return _run(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, String(value ?? '')]
    );
  },

  // ── Сотрудники ───────────────────────────────────────────────────────────────
  async getAllEmployees() {
    const employees = castEmployees(await _all("SELECT * FROM employees ORDER BY CASE WHEN status='archived' THEN 1 ELSE 0 END, name_lower"));
    const pendingRows = await _all('SELECT DISTINCT employee_id FROM pending_changes WHERE status = $1', ['pending']);
    const pendingIds = new Set(pendingRows.map(r => r.employee_id));
    return employees.map(e => ({ ...e, pendingCount: pendingIds.has(e.id) ? 1 : 0 }));
  },

  getEmployee(id) {
    return _get('SELECT * FROM employees WHERE id = $1', [Number(id)]).then(castEmployee);
  },

  getEmployeeByToken(token) {
    return _get('SELECT * FROM employees WHERE token = $1', [token]).then(castEmployee);
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
      await client.query('UPDATE employees SET token = $1, updated_at = $2 WHERE id = $3', [newToken, new Date().toISOString(), Number(id)]);
      await client.query('COMMIT');
      return castEmployee({ ...emp.rows[0], token: newToken });
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

  countPendingForEmployee(employeeId) {
    return _get("SELECT COUNT(*)::int cnt FROM pending_changes WHERE employee_id = $1 AND status = 'pending'", [Number(employeeId)]).then(r => r ? r.cnt : 0);
  },

  async submitChanges(employeeId, changesArray) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM pending_changes WHERE employee_id = $1 AND status IN ('pending','approved','rejected')", [Number(employeeId)]);
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
      if (emp.rows[0] && ALLOWED_FIELDS.has(change.field_name)) {
        await client.query(`UPDATE employees SET "${change.field_name}" = $1, updated_at = $2 WHERE id = $3`, [change.new_value, now, change.employee_id]);
        if (change.field_name === 'contacts') {
          const lines = (change.new_value || '').split('\n').filter(l => l.trim());
          if (lines[0]) await client.query('UPDATE employees SET city = $1 WHERE id = $2', [lines[0], change.employee_id]);
          const email = lines.find(l => l.includes('@'));
          if (email) await client.query('UPDATE employees SET email = $1 WHERE id = $2', [email, change.employee_id]);
        }
      }
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
    const ch = await _get('SELECT * FROM pending_changes WHERE id = $1', [Number(changeId)]);
    if (!ch || ch.status !== 'pending') return false;
    await _run("UPDATE pending_changes SET status = 'rejected', reviewed_at = $1, reviewed_by = $2, reject_reason = $3 WHERE id = $4",
      [new Date().toISOString(), reviewerName, reason, Number(changeId)]);
    return true;
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
          if (ALLOWED_FIELDS.has(ch.field_name)) {
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
    await _run("UPDATE pending_changes SET status = 'rejected', reviewed_at = $1, reviewed_by = $2, reject_reason = $3 WHERE employee_id = $4 AND status = 'pending'",
      [new Date().toISOString(), reviewerName, reason, Number(employeeId)]);
    const changes = await _all('SELECT * FROM pending_changes WHERE employee_id = $1 AND status = $2', [Number(employeeId), 'pending']);
    return changes.length;
  },

  async getStats() {
    const empCount = await _get("SELECT COUNT(*)::int cnt FROM employees WHERE status = 'active'");
    const pendingCount = await _get("SELECT COUNT(DISTINCT employee_id)::int cnt FROM pending_changes WHERE status = 'pending'");
    const approvedCount = await _get("SELECT COUNT(*)::int cnt FROM pending_changes WHERE status = 'approved'");
    return { total: empCount.cnt, pending: pendingCount.cnt, approved: approvedCount.cnt };
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
  getManagerByLogin(login) {
    return _get('SELECT * FROM managers WHERE email = $1', [String(login).trim().toLowerCase()]);
  },
  getManagerById(id) {
    return _get('SELECT * FROM managers WHERE id = $1', [Number(id)]);
  },
  getAllManagers() {
    return _all('SELECT id, name, email, role, created_at FROM managers ORDER BY name');
  },

  async createManager(name, login, passwordHash, role) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM managers WHERE email = $1', [String(login).trim().toLowerCase()]);
      if (existing.rows[0]) throw new Error('Менеджер с таким логином уже существует');
      const validRoles = ['admin', 'scrum', 'leader'];
      const managerRole = validRoles.includes(role) ? role : 'scrum';
      const result = await client.query(
        'INSERT INTO managers (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [String(name || '').trim(), String(login).trim().toLowerCase(), passwordHash, managerRole, new Date().toISOString()]
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

  async deleteManager(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const count = await client.query('SELECT COUNT(*)::int cnt FROM managers');
      if (count.rows[0].cnt <= 1) throw new Error('Нельзя удалить последнего менеджера');
      await client.query('DELETE FROM managers WHERE id = $1', [Number(id)]);
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
    await _run('UPDATE managers SET role = $1 WHERE id = $2', [role, Number(id)]);
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
  touch(sid, maxAge) {
    return _run('UPDATE sessions SET expired = $1 WHERE sid = $2', [Date.now() + maxAge, sid]);
  },
};

// ─── Запуск инициализации ─────────────────────────────────────────────────────
let initPromise = init();

module.exports = { helpers, FIELD_LABELS, pool, sessions, initPromise };
