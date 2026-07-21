const fs = require('fs');

function parseBlockArrayFlexible(raw, labelsMap) {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  
  const labelKeys = Object.keys(labelsMap);
  const escapedLabels = labelKeys.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(' + escapedLabels.join('|') + ')\\s*:\\s*', 'gi');
  
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      const val = text.substring(lastIndex, match.index).trim();
      if (tokens.length > 0) tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + val;
    }
    tokens.push({ key: labelsMap[match[1].toLowerCase().trim()], val: '' });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length && tokens.length > 0) {
    tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + text.substring(lastIndex).trim();
  }
  
  const entries = [];
  let currentEntry = null;
  
  for (const t of tokens) {
    if (currentEntry && currentEntry[t.key] !== undefined) currentEntry = null;
    if (!currentEntry) {
      currentEntry = {};
      entries.push(currentEntry);
    }
    currentEntry[t.key] = t.val;
  }
  
  return entries.filter(e => Object.values(e).some(val => typeof val === 'string' && val.trim() !== ''));
}

function parseExperience(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return { total: '', jobs: [] };

  const labelsMap = {
    'общий стаж': 'total',
    'компания': 'company',
    'должность': 'position',
    'период': 'period'
  };
  
  const labelKeys = Object.keys(labelsMap);
  const escapedLabels = labelKeys.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp('(' + escapedLabels.join('|') + ')\\s*:\\s*', 'gi');
  
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      const val = text.substring(lastIndex, match.index).trim();
      if (tokens.length > 0) tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + val;
    }
    tokens.push({ key: labelsMap[match[1].toLowerCase().trim()], val: '' });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length && tokens.length > 0) {
    tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + text.substring(lastIndex).trim();
  }
  
  let total = '';
  const jobs = [];
  let currentJob = null;
  
  for (const t of tokens) {
    if (t.key === 'total') {
      total = t.val;
    } else {
      if (currentJob && currentJob[t.key] !== undefined) currentJob = null;
      if (!currentJob) {
        currentJob = { company: '', position: '', period: '' };
        jobs.push(currentJob);
      }
      currentJob[t.key] = t.val;
    }
  }
  
  return { total, jobs: jobs.filter(j => j.company || j.position || j.period) };
}

console.log("=== EXPERIENCE ===");
const exp1 = 'Общий стаж: 15 лет Стаж работы в 1С: Компания: АО Корпоративные ИТ проекты Должность: Ведущий консультант Период: 2022 - настоящее время';
console.log(JSON.stringify(parseExperience(exp1), null, 2));

function parseProjects(raw) {
  const map = {
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
  const entries = parseBlockArrayFlexible(raw, map);
  return entries.map(e => ({
    period: e.period || '',
    position: e.position || '',
    role: e.role || '',
    team_size: e.team_size || '',
    client: e.client || '',
    project_description: e.project_description || '',
    task_description: e.task_description || '',
    technologies: e.technologies || ''
  }));
}

console.log("\n=== PROJECTS ===");
const proj1 = 'Период работы: 2025 г. Должность: Ведущий консультант Роль: Размер команды: Заказчик: крупнейший производитель Описание проекта: Внедрение системы Задача, реализованная сотрудником: Настроил учет Программные продукты / Технологии: 1С:ERP Период работы: 2024 Должность: Разработчик';
console.log(JSON.stringify(parseProjects(proj1), null, 2));
