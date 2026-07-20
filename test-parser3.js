function parseBlockArrayFlexible(raw, labelsMap) {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  
  const labelKeys = Object.keys(labelsMap);
  const escapedLabels = labelKeys.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  // REQUIRE a colon!
  const regex = new RegExp('(' + escapedLabels.join('|') + ')\\s*:\\s*', 'gi');
  
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      const val = text.substring(lastIndex, match.index).trim();
      if (tokens.length > 0) {
        tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + val;
      }
    }
    // match[1] is the label that was found
    tokens.push({ key: labelsMap[match[1].toLowerCase().trim()], val: '' });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length && tokens.length > 0) {
    tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + text.substring(lastIndex).trim();
  }
  
  const entries = [];
  let currentEntry = null;
  
  for (const t of tokens) {
    if (currentEntry && currentEntry[t.key] !== undefined) {
      currentEntry = null;
    }
    if (!currentEntry) {
      currentEntry = {};
      entries.push(currentEntry);
    }
    currentEntry[t.key] = t.val;
  }
  
  // Filter empty entries
  return entries.filter(e => Object.values(e).some(val => typeof val === 'string' && val.trim() !== ''));
}

const projMap = {
  'период работы': 'period',
  'должность': 'position',
  'роль': 'role',
  'размер команды': 'team_size',
  'заказчик': 'client',
  'описание проекта': 'project_description',
  'задача, реализованная сотрудником': 'task_description',
  'задача': 'task_description',
  'программные продукты / технологии': 'technologies',
  'программные продукты': 'technologies'
};

const raw = 'Период работы: 2021 Должность: Разработчик Роль: Тимлид Заказчик: Описание проекта: В этом проекте наша роль была ключевой. Заказчик остался доволен. Программные продукты / Технологии: JS, HTML Задача, реализованная сотрудником: Написал код.';
console.log(parseBlockArrayFlexible(raw, projMap));
