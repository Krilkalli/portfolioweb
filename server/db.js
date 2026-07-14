const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'portfolio.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    submitted_at TEXT,
    status TEXT DEFAULT 'pending',
    reviewed_at TEXT DEFAULT '',
    reject_reason TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_changes_status ON pending_changes(status);
  CREATE INDEX IF NOT EXISTS idx_changes_employee ON pending_changes(employee_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS employee_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    rating INTEGER,
    comment TEXT DEFAULT '',
    submitted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_employee ON employee_feedback(employee_id);

  CREATE TABLE IF NOT EXISTS managers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT
  );
`);
// Миграция: добавить колонку status если БД создана до этого обновления
try { db.exec("ALTER TABLE employees ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); } catch (e) {}
// Миграция: добавить колонку reviewed_by в pending_changes
try { db.exec("ALTER TABLE pending_changes ADD COLUMN reviewed_by TEXT DEFAULT ''"); } catch (e) {}
// Миграция: добавить колонку photo в employees
try { db.exec("ALTER TABLE employees ADD COLUMN photo TEXT DEFAULT ''"); } catch (e) {}
// Миграция: добавить колонку role в managers
try { db.exec("ALTER TABLE managers ADD COLUMN role TEXT DEFAULT 'admin'"); } catch (e) {}

// ─── Подготовленные запросы ──────────────────────────────────────────────────
const stGetSetting   = db.prepare('SELECT value FROM settings WHERE key = ?');
const stSetSetting   = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
const stDelSetting   = db.prepare('DELETE FROM settings WHERE key = ?');
const stGetAllEmployees = db.prepare("SELECT * FROM employees WHERE status = 'active' ORDER BY name_lower");
const stGetAllEmployeesAll = db.prepare("SELECT * FROM employees ORDER BY CASE WHEN status='archived' THEN 1 ELSE 0 END, name_lower");
const stGetEmployee  = db.prepare('SELECT * FROM employees WHERE id = ?');
const stGetByToken   = db.prepare('SELECT * FROM employees WHERE token = ?');
const stGetByEmail   = db.prepare('SELECT * FROM employees WHERE email = ? AND email != \'\' LIMIT 1');
const stGetByName    = db.prepare('SELECT * FROM employees WHERE name_lower = ? LIMIT 1');
const stInsertEmployee = db.prepare(`INSERT INTO employees
  (name, name_lower, education, position, contacts, experience, about, competencies,
   project_experience, certification, email, city, phone, token, status, created_at, updated_at)
  VALUES (@name, @name_lower, @education, @position, @contacts, @experience, @about,
   @competencies, @project_experience, @certification, @email, @city, @phone, @token, @status, @created_at, @updated_at)`);
const stUpdateEmployee = db.prepare(`UPDATE employees SET
  name=@name, name_lower=@name_lower, education=@education, position=@position,
  contacts=@contacts, experience=@experience, about=@about, competencies=@competencies,
  project_experience=@project_experience, certification=@certification,
  email=@email, city=@city, phone=@phone, updated_at=@updated_at WHERE id=@id`);
const stArchiveEmployee = db.prepare("UPDATE employees SET status='archived', updated_at=? WHERE id=?");
const stRestoreEmployee = db.prepare("UPDATE employees SET status='active', updated_at=? WHERE id=?");
const stGetChanges    = db.prepare('SELECT * FROM pending_changes WHERE status = ? ORDER BY submitted_at');
const stGetChangesAll = db.prepare('SELECT * FROM pending_changes ORDER BY submitted_at');
const stGetChangesByEmp = db.prepare('SELECT * FROM pending_changes WHERE employee_id = ? AND status = ?');
const stGetChange     = db.prepare('SELECT * FROM pending_changes WHERE id = ?');
const stHasPending    = db.prepare('SELECT 1 FROM pending_changes WHERE employee_id = ? AND status = \'pending\' LIMIT 1');
const stCountPending  = db.prepare('SELECT COUNT(DISTINCT employee_id) cnt FROM pending_changes WHERE status = \'pending\'');
const stInsertChange  = db.prepare(`INSERT INTO pending_changes
  (employee_id, field_name, old_value, new_value, submitted_at, status)
  VALUES (?, ?, ?, ?, ?, 'pending')`);
const stDelPendingForEmp = db.prepare('DELETE FROM pending_changes WHERE employee_id = ? AND status = \'pending\'');
const stApproveChange = db.prepare("UPDATE pending_changes SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ?");
const stRejectChange  = db.prepare("UPDATE pending_changes SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, reject_reason = ? WHERE id = ?");
const stApproveAll    = db.prepare("UPDATE pending_changes SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE employee_id = ? AND status = 'pending'");
const stRejectAll     = db.prepare("UPDATE pending_changes SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, reject_reason = ? WHERE employee_id = ? AND status = 'pending'");
const stInsertFeedback = db.prepare('INSERT INTO employee_feedback (employee_id, rating, comment, submitted_at) VALUES (?, ?, ?, ?)');
const stGetManagerByEmail = db.prepare('SELECT * FROM managers WHERE email = ?');
const stGetManagerById   = db.prepare('SELECT * FROM managers WHERE id = ?');
const stGetAllManagers   = db.prepare('SELECT id, name, email, role, created_at FROM managers ORDER BY name');
const stInsertManager    = db.prepare('INSERT INTO managers (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)');
const stDeleteManager    = db.prepare('DELETE FROM managers WHERE id = ?');

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
  // legacy formats:
  //   "ВУЗ\nСтепень\nСпециальность\nГод"  (newline-separated)
  //   "ВУЗ,\nСтепень,\nСпециальность,\nГод;"  (comma/semicolon delimited)
  //   "inst1,deg1,spec1,year1;inst2,deg2,spec2,year2"  (fully delimited)
  const text = String(val || '').trim();
  if (!text) return [];

  // Try fully delimited format (; between entries, , between fields)
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

  // Newline-separated format: each block separated by double newline,
  // within a block each field on its own line
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
function loadSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  try { s.positions = s.positions ? JSON.parse(s.positions) : []; } catch { s.positions = []; }
  return s;
}
function saveSettings(obj) {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      const val = k === 'positions' ? JSON.stringify(v) : String(v ?? '');
      stSetSetting.run(k, val);
    }
  });
  tx();
}

// ─── Миграция из CSV ──────────────────────────────────────────────────────────
function migrateFromCsv() {
  const count = db.prepare('SELECT COUNT(*) cnt FROM employees').get().cnt;
  if (count > 0) return;

  const csvDir = DATA_DIR;
  const csvFiles = ['employees.csv', 'pending_changes.csv', 'settings.csv'];

  // Read CSV files using the old functions still in this file
  // We need inline CSV parsing since we removed those functions
  function readCsv(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return parseCsv(content);
    } catch { return []; }
  }

  function parseCsv(content) {
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const rows = [];
    const lines = content.split(/\r?\n/);
    if (lines.length < 2) return rows;
    const headers = parseRow(lines[0]);
    let i = 1;
    while (i < lines.length) {
      if (!lines[i].trim()) { i++; continue; }
      let line = lines[i];
      let quoteCount = (line.match(/"/g) || []).length;
      while (quoteCount % 2 !== 0 && i + 1 < lines.length) {
        i++;
        line += '\n' + lines[i];
        quoteCount = (line.match(/"/g) || []).length;
      }
      const values = parseRow(line);
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = values[idx] ?? ''; });
      rows.push(obj);
      i++;
    }
    return rows;
  }

  function parseRow(line) {
    const fields = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        i++;
        let val = '';
        while (i < line.length) {
          if (line[i] === '"' && line[i+1] === '"') { val += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else { val += line[i]; i++; }
        }
        fields.push(val);
        if (line[i] === ',') i++;
      } else {
        let end = line.indexOf(',', i);
        if (end === -1) end = line.length;
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
    if (line.endsWith(',')) fields.push('');
    return fields;
  }

  // migrate settings.csv
  try {
    const setRows = readCsv(path.join(csvDir, 'settings.csv'));
    for (const r of setRows) {
      if (r.key) stSetSetting.run(r.key, r.value ?? '');
    }
  } catch {}

  // migrate pending_changes.csv
  try {
    const chgRows = readCsv(path.join(csvDir, 'pending_changes.csv'));
    for (const r of chgRows) {
      if (r.employee_id) {
        stInsertChange.run(Number(r.employee_id), r.field_name || '', r.old_value || '', r.new_value || '', r.submitted_at || new Date().toISOString());
      }
    }
  } catch {}

  // migrate employees.csv with deduplication
  try {
    const empRows = readCsv(path.join(csvDir, 'employees.csv'));
    const groups = {};
    for (const r of empRows) {
      if (!r.name) continue;
      const key = normalizeName(r.name);
      if (!groups[key]) { groups[key] = []; }
      groups[key].push(r);
    }

    const insertTx = db.transaction((emps) => {
      for (const e of emps) {
        const p = prepEmployee(e);
        stInsertEmployee.run(p);
      }
    });

    const merged = [];
    for (const [key, rows] of Object.entries(groups)) {
      // Keep the one with most non-empty fields; tie-break by highest id
      rows.sort((a, b) => {
        const aFilled = Object.values(a).filter(v => v && v !== '').length;
        const bFilled = Object.values(b).filter(v => v && v !== '').length;
        if (aFilled !== bFilled) return bFilled - aFilled;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });
      merged.push(rows[0]);
    }

    insertTx(merged);

    // rename CSV files to .bak
    for (const f of csvFiles) {
      const fp = path.join(csvDir, f);
      if (fs.existsSync(fp)) {
        const bak = fp + '.bak';
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
        fs.renameSync(fp, bak);
      }
    }

    console.log(`✅ Мигрировано ${merged.length} сотрудников из CSV в SQLite (удалено дубликатов: ${Object.keys(groups).length - merged.length})`);
  } catch (err) {
    console.error('⚠️ Ошибка миграции CSV:', err.message);
  }
}

// ─── Seed ──────────────────────────────────────────────────────────────────────
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

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) cnt FROM employees').get().cnt;
  if (count > 0) return;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const s of SEED) {
      const p = prepEmployee({
        ...s,
        education: parseLegacyEducation(s.education),
        experience: parseLegacyExperience(s.experience),
        project_experience: parseLegacyProject(s.project_experience),
      });
      stInsertEmployee.run(p);
    }
  });
  tx();
  console.log(`✅ Засеяно ${SEED.length} сотрудников`);
}

// ─── Инициализация ────────────────────────────────────────────────────────────
function init() {
  // Настройки
  let settings = loadSettings();
  let changed = false;
  const defs = { smtp_host:'', smtp_port:'587', smtp_user:'', smtp_pass:'', smtp_from:'Портфолио IS1C <noreply@is1c.ru>', manager_email:'' };
  for (const [k,v] of Object.entries(defs)) { if (settings[k] === undefined) { settings[k] = v; changed = true; } }
  if (!settings.positions || !Array.isArray(settings.positions) || settings.positions.length === 0) {
    settings.positions = ['Стажер-консультант по внедрению 1С','Младший консультант по внедрению 1С','Консультант по внедрению 1С','Старший консультант по внедрению 1С','Ведущий консультант по внедрению 1С','Эксперт-консультант по внедрению 1С'];
    changed = true;
  }
  if (changed) saveSettings(settings);

  // Миграция: переименовать 'Аналитик' → 'Консультант' в компетенциях
  const oldComps = helpers.getPositionCompetencies();
  if (oldComps['Аналитик'] !== undefined && oldComps['Консультант'] === undefined) {
    oldComps['Консультант'] = oldComps['Аналитик'];
    delete oldComps['Аналитик'];
    helpers.setPositionCompetencies(oldComps);
    console.log('✅ Компетенции: группа «Аналитик» переименована в «Консультант»');
  }

  // Seed: если positionCompetencies пусто, заполнить по умолчанию
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
  const managerCount = db.prepare('SELECT COUNT(*) cnt FROM managers').get().cnt;
  if (managerCount === 0) {
    const hash = settings.manager_password_hash || bcrypt.hashSync(config.defaultManagerPassword, 10);
    const login = 'admin';
    stInsertManager.run('Главный администратор', login, hash, 'admin', new Date().toISOString());
    console.log(`✅ Создан менеджер по умолчанию: ${login}`);
  }
  // Миграция: установить роль 'admin' всем менеджерам без роли
  db.prepare("UPDATE managers SET role = 'admin' WHERE role IS NULL OR role = ''").run();
  // Миграция: если есть старый manager_password_hash, удалить его из настроек
  if (settings.manager_password_hash) {
    db.prepare("DELETE FROM settings WHERE key = 'manager_password_hash'").run();
  }

  // Миграция из CSV если есть
  migrateFromCsv();

  // Seed если пусто
  seedIfEmpty();

  // ── Пост-миграции ──────────────────────────────────────────────────────────
  // Конвертировать legacy-текст в JSON, удалить устаревшие pending_changes
  const fixTx = db.transaction(() => {
    const allRows = db.prepare("SELECT id, education, experience, project_experience FROM employees").all();
    for (const row of allRows) {
      if (row.education && !row.education.startsWith('[') && row.education.trim()) {
        const parsed = parseLegacyEducationLines(row.education);
        db.prepare("UPDATE employees SET education = ? WHERE id = ?").run(JSON.stringify(parsed), row.id);
      }
      if (row.experience && !row.experience.startsWith('{') && row.experience.trim()) {
        const parsed = parseLegacyExperience(row.experience);
        db.prepare("UPDATE employees SET experience = ? WHERE id = ?").run(JSON.stringify(parsed), row.id);
      }
      if (row.project_experience && !row.project_experience.startsWith('[') && row.project_experience.trim()) {
        const parsed = parseLegacyProject(row.project_experience);
        db.prepare("UPDATE employees SET project_experience = ? WHERE id = ?").run(JSON.stringify(parsed), row.id);
      }
    }
    db.prepare("DELETE FROM pending_changes WHERE field_name IN ('courses','cert_date')").run();
  });
  fixTx();
}

// ─── Публичные helpers ────────────────────────────────────────────────────────
const helpers = {
  // ── Настройки ───────────────────────────────────────────────────────────────
  getSetting(key) {
    const r = stGetSetting.get(key);
    return r ? r.value : '';
  },
  setSetting(key, value) {
    stSetSetting.run(key, String(value ?? ''));
  },

  // ── Сотрудники ───────────────────────────────────────────────────────────────
  getAllEmployees() {
    const employees = castEmployees(stGetAllEmployeesAll.all());
    const pendingIds = new Set(
      db.prepare('SELECT DISTINCT employee_id FROM pending_changes WHERE status = ?').all('pending').map(r => r.employee_id)
    );
    return employees.map(e => ({ ...e, pendingCount: pendingIds.has(e.id) ? 1 : 0 }));
  },

  getEmployee(id) {
    return castEmployee(stGetEmployee.get(Number(id)));
  },

  getEmployeeByToken(token) {
    return castEmployee(stGetByToken.get(token));
  },

  createEmployee(data) {
    const tx = db.transaction(() => {
      // check for duplicate by normalized name
      const norm = normalizeName(data.name);
      const existing = stGetByName.get(norm);
      if (existing) {
        // Update existing
        const now = new Date().toISOString();
        const p = { ...prepEmployee(data), id: existing.id };
        stUpdateEmployee.run(p);
        const updated = castEmployee(stGetEmployee.get(existing.id));

        // Если имя совпадает, но изменилось — обновить
        return updated;
      }
      const p = prepEmployee(data);
      const info = stInsertEmployee.run(p);
      return castEmployee(stGetEmployee.get(info.lastInsertRowid));
    });
    return tx();
  },

  updateEmployee(id, fields) {
    const tx = db.transaction(() => {
      const emp = stGetEmployee.get(Number(id));
      if (!emp) return null;
      const now = new Date().toISOString();
      const updates = {};
      for (const k of ALLOWED_FIELDS) {
        if (fields[k] !== undefined) updates[k] = fields[k];
      }
      if (Object.keys(updates).length === 0) return castEmployee(emp);
      // Build dynamic update SQL safely
      const setClauses = [];
      const params = { id: Number(id) };
      for (const [k, v] of Object.entries(updates)) {
        setClauses.push(`${k} = @${k}`);
        params[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      }
      if (updates.name) {
        setClauses.push('name_lower = @name_lower');
        params.name_lower = normalizeName(updates.name);
      }
      setClauses.push('updated_at = @updated_at');
      params.updated_at = now;
      const sql = `UPDATE employees SET ${setClauses.join(', ')} WHERE id = @id`;
      db.prepare(sql).run(params);
      return castEmployee(stGetEmployee.get(Number(id)));
    });
    return tx();
  },

  regenerateToken(id) {
    const tx = db.transaction(() => {
      const emp = stGetEmployee.get(Number(id));
      if (!emp) return null;
      const newToken = uuidv4();
      db.prepare('UPDATE employees SET token = ?, updated_at = ? WHERE id = ?').run(newToken, new Date().toISOString(), Number(id));
      return castEmployee({ ...emp, token: newToken });
    });
    return tx();
  },

  // ── Архивация (мягкое удаление) ──────────────────────────────────────────────
  archiveEmployee(id) {
    const emp = stGetEmployee.get(Number(id));
    if (!emp) return false;
    stArchiveEmployee.run(new Date().toISOString(), Number(id));
    return true;
  },
  restoreEmployee(id) {
    const emp = stGetEmployee.get(Number(id));
    if (!emp) return false;
    stRestoreEmployee.run(new Date().toISOString(), Number(id));
    return true;
  },

  // Полная очистка списка сотрудников (используется перед импортом Excel,
  // когда файл должен полностью заменить текущие данные). Настройки (SMTP,
  // должности, пароль) не затрагиваются.
  deleteAllEmployees() {
    const tx = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) cnt FROM employees').get().cnt;
      db.prepare('DELETE FROM employees').run();
      return count;
    });
    return tx();
  },

  upsertEmployee(data) {
    const tx = db.transaction(() => {
      const norm = normalizeName(data.name);
      let existing = stGetByName.get(norm);
      if (!existing && data.email) existing = stGetByEmail.get(data.email);
      const now = new Date().toISOString();
      if (existing) {
        const allowed = ['education','position','contacts','experience','about','competencies','project_experience','certification','email','city'];
        const p = { ...prepEmployee(existing), id: existing.id };
        for (const k of allowed) {
          if (data[k] !== undefined) {
            const val = typeof data[k] === 'object' ? JSON.stringify(data[k]) : String(data[k] ?? '');
            p[k] = val;
          }
        }
        p.updated_at = now;
        stUpdateEmployee.run(p);
        return 'updated';
      } else {
        const p = { ...prepEmployee(data), created_at: now, updated_at: now };
        stInsertEmployee.run(p);
        return 'inserted';
      }
    });
    return tx();
  },

  // ── Должности ────────────────────────────────────────────────────────────────
  getPositions() {
    const s = loadSettings();
    return s.positions || [];
  },
  addPosition(name) {
    const s = loadSettings();
    if (!s.positions) s.positions = [];
    if (!s.positions.includes(name)) s.positions.push(name);
    saveSettings(s);
    return s.positions;
  },
  removePosition(name) {
    const s = loadSettings();
    if (!s.positions) s.positions = [];
    s.positions = s.positions.filter(p => p !== name);
    saveSettings(s);
    return s.positions;
  },

  // ── Изменения ────────────────────────────────────────────────────────────────
  getPendingGrouped() {
    const all = stGetChanges.all('pending');
    // Фильтр на случай, если в БД остались устаревшие записи
    const changes = all.filter(c => c.field_name !== 'courses' && c.field_name !== 'cert_date');
    const empIds = [...new Set(changes.map(c => c.employee_id))];
    const emps = {};
    for (const id of empIds) {
      const e = stGetEmployee.get(id);
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
          changes: [],
        };
      }
      grouped[c.employee_id].changes.push(c);
    }
    return { count: Object.keys(grouped).length, groups: Object.values(grouped) };
  },

  getPendingByEmployee(employeeId) {
    return stGetChangesByEmp.all(Number(employeeId), 'pending');
  },

  hasPendingForEmployee(employeeId) {
    const r = stHasPending.get(Number(employeeId));
    return !!r;
  },

  countPending() {
    const r = stCountPending.get();
    return r ? r.cnt : 0;
  },

  getChangeById(id) {
    return stGetChange.get(Number(id)) || null;
  },

  getPendingChangesForEmployee(employeeId) {
    return stGetChangesByEmp.all(Number(employeeId), 'pending') || [];
  },

  submitChanges(employeeId, changesArray) {
    const tx = db.transaction(() => {
      stDelPendingForEmp.run(Number(employeeId));
      const now = new Date().toISOString();
      for (const ch of changesArray) {
        stInsertChange.run(Number(employeeId), ch.field_name || '', ch.old_value || '', ch.new_value || '', now);
      }
    });
    tx();
  },

  approveChange(changeId, reviewerName = '') {
    const tx = db.transaction(() => {
      const ch = stGetChange.get(Number(changeId));
      if (!ch || ch.status !== 'pending') return false;
      const emp = stGetEmployee.get(ch.employee_id);
      if (emp && ALLOWED_FIELDS.has(ch.field_name)) {
        const now = new Date().toISOString();
        db.prepare(`UPDATE employees SET "${ch.field_name}" = ?, updated_at = ? WHERE id = ?`).run(ch.new_value, now, ch.employee_id);
      }
      stApproveChange.run(new Date().toISOString(), reviewerName, Number(changeId));
      return true;
    });
    return tx();
  },

  rejectChange(changeId, reason = '', reviewerName = '') {
    const ch = stGetChange.get(Number(changeId));
    if (!ch || ch.status !== 'pending') return false;
    stRejectChange.run(new Date().toISOString(), reviewerName, reason, Number(changeId));
    return true;
  },

  approveAllForEmployee(employeeId, reviewerName = '') {
    const tx = db.transaction(() => {
      const changes = stGetChangesByEmp.all(Number(employeeId), 'pending');
      const now = new Date().toISOString();
      const emp = stGetEmployee.get(Number(employeeId));
      if (emp) {
        for (const ch of changes) {
          if (ALLOWED_FIELDS.has(ch.field_name)) {
            db.prepare(`UPDATE employees SET "${ch.field_name}" = ?, updated_at = ? WHERE id = ?`).run(ch.new_value, now, ch.employee_id);
          }
        }
      }
      stApproveAll.run(now, reviewerName, Number(employeeId));
      return changes.length;
    });
    return tx();
  },

  rejectAllForEmployee(employeeId, reason = '', reviewerName = '') {
    stRejectAll.run(new Date().toISOString(), reviewerName, reason, Number(employeeId));
    const changes = stGetChangesByEmp.all(Number(employeeId), 'pending');
    return changes.length;
  },

  getStats() {
    const empCount = db.prepare("SELECT COUNT(*) cnt FROM employees WHERE status = 'active'").get().cnt;
    const pendingCount = stCountPending.get().cnt;
    const approvedCount = db.prepare("SELECT COUNT(*) cnt FROM pending_changes WHERE status = 'approved'").get().cnt;
    return { total: empCount, pending: pendingCount, approved: approvedCount };
  },

  saveFeedback(employeeId, rating, comment) {
    stInsertFeedback.run(Number(employeeId), rating || null, comment || '', new Date().toISOString());
  },

  // ── Менеджеры ────────────────────────────────────────────────────────────────
  getManagerByLogin(login) {
    return stGetManagerByEmail.get(String(login).trim().toLowerCase());
  },
  getManagerById(id) {
    return stGetManagerById.get(Number(id));
  },
  getAllManagers() {
    return stGetAllManagers.all();
  },
  createManager(name, login, passwordHash, role) {
    const tx = db.transaction(() => {
      const existing = stGetManagerByEmail.get(String(login).trim().toLowerCase());
      if (existing) throw new Error('Менеджер с таким логином уже существует');
      const validRoles = ['admin', 'scrum', 'leader'];
      const managerRole = validRoles.includes(role) ? role : 'scrum';
      stInsertManager.run(
        String(name || '').trim(),
        String(login).trim().toLowerCase(),
        passwordHash,
        managerRole,
        new Date().toISOString()
      );
      return stGetManagerByEmail.get(String(login).trim().toLowerCase());
    });
    return tx();
  },
  deleteManager(id) {
    const tx = db.transaction(() => {
      const count = db.prepare('SELECT COUNT(*) cnt FROM managers').get().cnt;
      if (count <= 1) throw new Error('Нельзя удалить последнего менеджера');
      stDeleteManager.run(Number(id));
    });
    tx();
  },
  updateManagerPassword(id, newHash) {
    db.prepare('UPDATE managers SET password_hash = ? WHERE id = ?').run(newHash, Number(id));
  },
  updateManagerRole(id, role) {
    const validRoles = ['admin', 'scrum', 'leader'];
    if (!validRoles.includes(role)) throw new Error('Неверная роль');
    db.prepare('UPDATE managers SET role = ? WHERE id = ?').run(role, Number(id));
  },

  // ── Компетенции по должностям ──────────────────────────────────────────────
  getPositionCompetencies() {
    const val = helpers.getSetting('position_competencies');
    try { return JSON.parse(val || '{}'); } catch { return {}; }
  },
  setPositionCompetencies(obj) {
    helpers.setSetting('position_competencies', JSON.stringify(obj));
  },
  addPositionCompetency(position, competency) {
    const all = helpers.getPositionCompetencies();
    if (!all[position]) all[position] = [];
    if (!all[position].includes(competency)) all[position].push(competency);
    helpers.setPositionCompetencies(all);
    return all[position];
  },
  removePositionCompetency(position, competency) {
    const all = helpers.getPositionCompetencies();
    if (all[position]) {
      all[position] = all[position].filter(c => c !== competency);
      if (all[position].length === 0) delete all[position];
    }
    helpers.setPositionCompetencies(all);
    return all[position] || [];
  },

  // ── Уникальные значения для фильтров ──────────────────────────────────────
  getFilterData() {
    const rows = db.prepare("SELECT position, city, certification FROM employees WHERE status = 'active'").all();
    const positions = new Set();
    const cities = new Set();
    const certs = new Set();
    for (const r of rows) {
      if (r.position) positions.add(r.position);
      if (r.city) cities.add(r.city);
      if (r.certification) {
        // Parse individual cert names from certification text
        const lines = r.certification.split(/\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          // Remove common prefixes and get cert name
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

init();
module.exports = { helpers, FIELD_LABELS };
