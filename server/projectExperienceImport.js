const XLSX = require('xlsx');

const REQUIRED_HEADERS = [
  'Сотрудник',
  'ФункциональнаяОбласть',
  'ПрограммныйПродукт',
  'Опыт',
  'Проект',
  'ДатаНачала',
  'ДатаОкончания',
];

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_HEADERS.filter(header => column[header] === undefined);
  if (missing.length) throw new Error(`Не найдены обязательные колонки: ${missing.join(', ')}`);

  const activeRows = [];
  const inactiveEmployees = new Set();
  let skippedInactiveRows = 0;

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const values = matrix[rowIndex];
    const employeeName = String(values[column.Сотрудник] || '').trim();
    const projectTitle = String(values[column.Проект] || '').trim();
    if (!employeeName || !projectTitle) continue;

    const employeeCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column.Сотрудник })];
    if (isYellow(employeeCell)) {
      inactiveEmployees.add(employeeName);
      skippedInactiveRows += 1;
      continue;
    }

    activeRows.push({
      sourceReference: String(values[column.Ссылка] || '').trim(),
      sourceRowNumber: String(values[column.НомерСтроки] || '').trim(),
      employeeName,
      position: String(values[column.Должность] || '').trim(),
      participationStart: String(values[column.ДатаВхода] || '').trim(),
      participationEnd: String(values[column.ДатаВыхода] || '').trim(),
      functionalBlock: String(values[column.ФункциональнаяОбласть] || '').trim(),
      technology: String(values[column.ПрограммныйПродукт] || '').trim(),
      experienceType: String(values[column.Опыт] || '').trim(),
      isPrimaryConsultant: normalize(values[column.ОсновнойКонсультант]) === 'да',
      projectTitle,
      projectStart: String(values[column.ДатаНачала] || '').trim(),
      projectEnd: String(values[column.ДатаОкончания] || '').trim(),
    });
  }

  const projectsByTitle = new Map();
  for (const row of activeRows) {
    const key = normalize(row.projectTitle);
    if (!projectsByTitle.has(key)) projectsByTitle.set(key, { title: row.projectTitle, rows: [] });
    projectsByTitle.get(key).rows.push(row);
  }

  const projects = [...projectsByTitle.values()].map(group => {
    const membersByName = new Map();
    for (const row of group.rows) {
      const key = normalize(row.employeeName);
      if (!membersByName.has(key)) {
        membersByName.set(key, {
          name: row.employeeName,
          position: row.position,
          participationStart: row.participationStart,
          participationEnd: row.participationEnd,
          functionalBlocks: [],
          technologies: [],
          experienceTypes: [],
          isPrimaryConsultant: false,
        });
      }
      const member = membersByName.get(key);
      member.position ||= row.position;
      member.participationStart = minDate([member.participationStart, row.participationStart]);
      member.participationEnd = maxDate([member.participationEnd, row.participationEnd]);
      member.functionalBlocks = unique([...member.functionalBlocks, row.functionalBlock]);
      member.technologies = unique([...member.technologies, row.technology]);
      member.experienceTypes = unique([...member.experienceTypes, row.experienceType]);
      member.isPrimaryConsultant ||= row.isPrimaryConsultant;
    }
    const functionalBlocks = unique(group.rows.map(row => row.functionalBlock));
    const technologies = unique(group.rows.map(row => row.technology));
    const experienceTypes = unique(group.rows.map(row => row.experienceType));
    return {
      title: group.title,
      startPeriod: toMonthYear(minDate(group.rows.map(row => row.projectStart))),
      endPeriod: toMonthYear(maxDate(group.rows.map(row => row.projectEnd))),
      functionalBlocks,
      technologies,
      experienceTypes,
      description: [
        functionalBlocks.length ? `Функциональные области: ${functionalBlocks.join(', ')}` : '',
        experienceTypes.length ? `Виды работ: ${experienceTypes.join(', ')}` : '',
      ].filter(Boolean).join('. '),
      members: [...membersByName.values()].map(member => ({
        ...member,
        participationStart: toMonthYear(member.participationStart),
        participationEnd: toMonthYear(member.participationEnd),
      })),
      sourceRows: group.rows,
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
