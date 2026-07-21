const fs = require('fs');
const code = fs.readFileSync('public/js/manager.js', 'utf8');
const lines = code.split('\n');
lines.forEach((line, i) => {
  if (line.includes('редактировать') || line.includes('edit') || line.includes('Редактировать') || line.includes('mode=manager')) {
    console.log((i+1) + ': ' + line.trim());
  }
});
