function parseBlockArrayFlexible(raw, labelsMap) {
  const text = String(raw || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  
  const labelKeys = Object.keys(labelsMap);
  const escapedLabels = labelKeys.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  // Notice we removed '^' so it finds the labels ANYWHERE in the text!
  const regex = new RegExp('(' + escapedLabels.join('|') + ')\\s*:?\\s*', 'gi');
  
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (lastIndex < match.index) {
      const val = text.substring(lastIndex, match.index).trim();
      if (tokens.length > 0) tokens[tokens.length - 1].val += (tokens[tokens.length-1].val ? '\n' : '') + val;
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

const eduMap = {
  'учебное заведение': 'institution',
  'степень': 'degree',
  'специальность': 'specialty',
  'год окончания': 'year',
  'год': 'year'
};

console.log(parseBlockArrayFlexible('Учебное заведение: НГУ Степень: Высшая Год окончания: 2020 Учебное заведение: МГУ', eduMap));
console.log(parseBlockArrayFlexible('Год окончания: 2020 Учебное заведение: МГУ', eduMap));
