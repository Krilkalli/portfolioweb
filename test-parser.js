const fs = require('fs');

function extractField(line, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp('^\\s*' + escaped + '\\s*:\\s*(.*)$', 'i');
  const m = line.match(re);
  return m ? m[1].trim() : null;
}

function parseEducation(raw) {
  if (!raw || !String(raw).trim()) return [];
  const entries = [];
  let currentEntry = null;
  let currentKey = null;

  for (const line of String(raw).split('\n')) {
    let v;
    if ((v = extractField(line, 'Учебное заведение')) !== null) {
      if (currentEntry && currentEntry.institution) currentEntry = null;
      if (!currentEntry) { currentEntry = { institution: '', degree: '', specialty: '', year: '' }; entries.push(currentEntry); }
      currentEntry.institution = v;
      currentKey = 'institution';
    } else if ((v = extractField(line, 'Степень')) !== null) {
      if (currentEntry && currentEntry.degree) currentEntry = null;
      if (!currentEntry) { currentEntry = { institution: '', degree: '', specialty: '', year: '' }; entries.push(currentEntry); }
      currentEntry.degree = v;
      currentKey = 'degree';
    } else if ((v = extractField(line, 'Специальность')) !== null) {
      if (currentEntry && currentEntry.specialty) currentEntry = null;
      if (!currentEntry) { currentEntry = { institution: '', degree: '', specialty: '', year: '' }; entries.push(currentEntry); }
      currentEntry.specialty = v;
      currentKey = 'specialty';
    } else if ((v = extractField(line, 'Год окончания')) !== null) {
      if (currentEntry && currentEntry.year) currentEntry = null;
      if (!currentEntry) { currentEntry = { institution: '', degree: '', specialty: '', year: '' }; entries.push(currentEntry); }
      currentEntry.year = v;
      currentKey = 'year';
    } else if (currentKey) {
      currentEntry[currentKey] += '\n' + line;
    }
  }

  return entries.filter(e => e.institution || e.degree || e.specialty || e.year);
}

const res1 = parseEducation('Учебное заведение: НГУ\nСтепень: Высшая\nГод окончания: 2020\nУчебное заведение: МГУ');
console.log('res1:', res1);

const res2 = parseEducation('Год окончания: 2020 Учебное заведение: МГУ');
console.log('res2:', res2);

const res3 = parseEducation('Год: 2020');
console.log('res3:', res3);
