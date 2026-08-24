const XLSX = require('xlsx');

const REQUIRED_COLUMNS = [
  { key: 'employeeName', label: 'Сотрудник', aliases: ['Сотрудник'] },
  { key: 'functionalBlock', label: 'Функциональная область', aliases: ['ФункциональнаяОбласть', 'Функциональная область'] },
  { key: 'technology', label: 'Программный продукт', aliases: ['ПрограммныйПродукт', 'Программный продукт'] },
  { key: 'projectTitle', label: 'Название', aliases: ['Название', 'Проект'] },
  { key: 'projectStart', label: 'Дата начала', aliases: ['ДатаНачала', 'Дата начала'] },
  { key: 'projectEnd', label: 'Дата окончания', aliases: ['ДатаОкончания', 'Дата окончания'] },
];

const OPTIONAL_COLUMNS = [
  { key: 'sourceReference', aliases: ['Ссылка'] },
  { key: 'sourceRowNumber', aliases: ['НомерСтроки', 'Номер строки'] },
  { key: 'role', aliases: ['Должность'] },
  { key: 'participationStart', aliases: ['ДатаВхода', 'Дата входа'] },
  { key: 'participationEnd', aliases: ['ДатаВыхода', 'Дата выхода'] },
];

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeHeader(value) {
  return normalize(value).replace(/[\s_]+/g, '');
}

function resolveColumns(headers) {
  const byHeader = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
  const resolved = {};
  for (const definition of [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]) {
    const alias = definition.aliases.find(value => byHeader.has(normalizeHeader(value)));
    if (alias) resolved[definition.key] = byHeader.get(normalizeHeader(alias));
  }
  const missing = REQUIRED_COLUMNS.filter(definition => resolved[definition.key] === undefined);
  if (missing.length) throw new Error(`Не найдены обязательные колонки: ${missing.map(item => item.label).join(', ')}`);
  return resolved;
}

function cellValue(values, column, key) {
  return column[key] === undefined ? '' : String(values[column[key]] || '').trim();
}

function isYellow(cell) {
  const style = cell?.s?.fill || cell?.s || {};
  const rgb = String(style?.fgColor?.rgb || '').toUpperCase().replace(/^FF(?=[0-9A-F]{6}$)/, '');
  const indexed = Number(style?.fgColor?.indexed);
  return ['FFFF00', 'FFF2CC', 'FFFF99', 'FFD966', 'FFC000'].includes(rgb) || [6, 27, 44].includes(indexed);
}

function unique(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function minDate(values) {
  return values.filter(Boolean).sort((a, b) => dateKey(a).localeCompare(dateKey(b)))[0] || '';
}

function maxDate(values) {
  return values.filter(Boolean).sort((a, b) => dateKey(b).localeCompare(dateKey(a)))[0] || '';
}

function dateKey(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (!match) return text;
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function toMonthYear(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  return match ? `${match[2].padStart(2, '0')}.${match[3]}` : text;
}

function parseProjectExperienceFile(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, cellStyles: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('В файле не найден лист с данными');
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) throw new Error('Файл не содержит данных');

  const headers = matrix[0].map(value => String(value || '').trim());
  const column = resolveColumns(headers);

  const activeRows = [];
  const allRows = [];
  const inactiveEmployees = new Set();
  let skippedInactiveRows = 0;

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const values = matrix[rowIndex];
    const employeeName = cellValue(values, column, 'employeeName');
    const projectTitle = cellValue(values, column, 'projectTitle');
    if (!employeeName || !projectTitle) continue;

    const employeeCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column.employeeName })];
    const active = !isYellow(employeeCell);
    const row = {
      sourceReference: cellValue(values, column, 'sourceReference'),
      sourceRowNumber: cellValue(values, column, 'sourceRowNumber'),
      employeeName,
      role: cellValue(values, column, 'role'),
      participationStart: cellValue(values, column, 'participationStart'),
      participationEnd: cellValue(values, column, 'participationEnd'),
      functionalBlock: cellValue(values, column, 'functionalBlock'),
      technology: cellValue(values, column, 'technology'),
      projectTitle,
      projectStart: cellValue(values, column, 'projectStart'),
      projectEnd: cellValue(values, column, 'projectEnd'),
      active,
    };
    allRows.push(row);

    if (!active) {
      inactiveEmployees.add(employeeName);
      skippedInactiveRows += 1;
      continue;
    }
    activeRows.push(row);
  }

  const projectsByTitle = new Map();
  for (const row of allRows) {
    const key = normalize(row.projectTitle);
    if (!projectsByTitle.has(key)) projectsByTitle.set(key, { title: row.projectTitle, rows: [] });
    projectsByTitle.get(key).rows.push(row);
  }

  const projects = [...projectsByTitle.values()].filter(group => group.rows.some(row => row.active)).map(group => {
    const membersByName = new Map();
    const workingRows = group.rows.filter(row => row.active);
    for (const row of workingRows) {
      const key = normalize(row.employeeName);
      if (!membersByName.has(key)) {
        membersByName.set(key, {
          name: row.employeeName,
          role: row.role,
          participationStart: row.participationStart,
          participationEnd: row.participationEnd,
          functionalAreas: [],
          technologies: [],
        });
      }
      const member = membersByName.get(key);
      member.role ||= row.role;
      member.participationStart = minDate([member.participationStart, row.participationStart]);
      member.participationEnd = maxDate([member.participationEnd, row.participationEnd]);
      member.functionalAreas = unique([...member.functionalAreas, row.functionalBlock]);
      member.technologies = unique([...member.technologies, row.technology]);
    }
    const functionalAreas = unique(group.rows.map(row => row.functionalBlock));
    const technologies = unique(group.rows.map(row => row.technology));
    const fullTeamSize = new Set(group.rows.map(row => normalize(row.employeeName)).filter(Boolean)).size;
    return {
      title: group.title,
      startPeriod: toMonthYear(minDate(group.rows.map(row => row.projectStart))),
      endPeriod: toMonthYear(maxDate(group.rows.map(row => row.projectEnd))),
      fullTeamSize,
      functionalArea: functionalAreas.join(', '),
      technologies,
      description: '',
      members: [...membersByName.values()].map(member => ({
        ...member,
        participationStart: toMonthYear(member.participationStart),
        participationEnd: toMonthYear(member.participationEnd),
      })),
      sourceRows: workingRows.map(({ active, ...row }) => row),
    };
  });

  return {
    sheetName,
    totalRows: Math.max(0, matrix.length - 1),
    activeRows: activeRows.length,
    skippedInactiveRows,
    inactiveEmployees: [...inactiveEmployees].sort((a, b) => a.localeCompare(b, 'ru')),
    projects,
  };
}

module.exports = { parseProjectExperienceFile, isYellow, normalize };
