const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, AlignmentType, WidthType } = require('docx');
const path = require('path');
const fs = require('fs');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const DEFAULT_TEMPLATE = path.join(TEMPLATES_DIR, 'resume_template.docx');

const FIELD_LABELS = {
  name: 'ФИО',
  education: 'Образование',
  position: 'Должность',
  contacts: 'Контакты',
  experience: 'Стаж работы',
  about: 'Обо мне',
  competencies: 'Компетенции',
  project_experience: 'Проектный опыт',
  certification: 'Сертификация',
};

function formatEducation(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map(x => [x.institution, x.degree, x.specialty, x.year].filter(Boolean).join(', ')).join('\n');
  return String(e);
}

function formatExperience(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e.total) {
    const jobs = (e.jobs || []).map(j => [j.company, j.position, j.period].filter(Boolean).join(' | ')).join('\n');
    return `Общий стаж: ${e.total}${jobs ? '\n' + jobs : ''}`;
  }
  return String(e);
}

function formatProject(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (Array.isArray(p)) return p.map(x => {
    const f = [x.period && `Период: ${x.period}`, x.client && `Заказчик: ${x.client}`, x.role && `Роль: ${x.role}`, x.team_size && `Команда: ${x.team_size}`, x.project_description && `Описание: ${x.project_description}`, x.task_description && `Задача: ${x.task_description}`, x.technologies && `Технологии: ${x.technologies}`].filter(Boolean);
    return f.join('\n');
  }).join('\n\n');
  return String(p);
}

function formatCertification(c) {
  if (!c) return '';
  if (typeof c === 'string') return c.split('\n').filter(l => l.trim() && !l.includes('Сертификация 1С:') && l !== '-').map(l => l.replace(/^[-•]\s*/, '').replace(/;$/, '')).join('\n');
  return String(c);
}

async function createDefaultTemplate() {
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } } },
      children: [
        new Paragraph({ children: [new TextRun({ text: '{name}', bold: true, size: 40, font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: '{position}', size: 28, color: '6C63FF', font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: '{contacts}', size: 18, color: '666666', font: 'Calibri' })], spacing: { after: 200 } }),
        new Paragraph({ border: { bottom: { color: '6C63FF', size: 6, style: BorderStyle.SINGLE } }, spacing: { before: 120, after: 120 }, children: [] }),
        new Paragraph({ children: [new TextRun({ text: 'ОБО МНЕ', bold: true, size: 22, color: '6C63FF', font: 'Calibri' })], spacing: { before: 300, after: 100 } }),
        new Paragraph({ children: [new TextRun({ text: '{about}', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: 'КЛЮЧЕВЫЕ КОМПЕТЕНЦИИ', bold: true, size: 22, color: '6C63FF', font: 'Calibri' })], spacing: { before: 300, after: 100 } }),
        new Paragraph({ children: [new TextRun({ text: '{competencies}', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: 'СТАЖ РАБОТЫ', bold: true, size: 22, color: '6C63FF', font: 'Calibri' })], spacing: { before: 300, after: 100 } }),
        new Paragraph({ children: [new TextRun({ text: '{experience}', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: 'ПРОЕКТНЫЙ ОПЫТ', bold: true, size: 22, color: '6C63FF', font: 'Calibri' })], spacing: { before: 300, after: 100 } }),
        new Paragraph({ children: [new TextRun({ text: '{project_experience}', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: 'ОБРАЗОВАНИЕ', bold: true, size: 22, color: '6C63FF', font: 'Calibri' })], spacing: { before: 300, after: 100 } }),
        new Paragraph({ children: [new TextRun({ text: '{education}', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: 'СЕРТИФИКАТЫ 1С', bold: true, size: 22, color: '6C63FF', font: 'Calibri' })], spacing: { before: 300, after: 100 } }),
        new Paragraph({ children: [new TextRun({ text: '{certification}', size: 22, font: 'Calibri' })], spacing: { after: 80 } }),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(DEFAULT_TEMPLATE, buf);
  console.log('✅ Создан базовый шаблон:', DEFAULT_TEMPLATE);
}

if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
if (!fs.existsSync(DEFAULT_TEMPLATE)) createDefaultTemplate().catch(console.error);

function getTemplatePath() {
  const uploaded = path.join(TEMPLATES_DIR, 'custom_template.docx');
  return fs.existsSync(uploaded) ? uploaded : DEFAULT_TEMPLATE;
}

function prepareData(employee) {
  return {
    name: employee.name || '',
    position: employee.position || '',
    contacts: (employee.contacts || '').split('\n').filter(l => l.trim()).join(' | '),
    about: employee.about || '',
    competencies: employee.competencies || '',
    education: formatEducation(employee.education),
    experience: formatExperience(employee.experience),
    project_experience: formatProject(employee.project_experience),
    certification: formatCertification(employee.certification),
  };
}

async function generateFromTemplate(employee) {
  const PizZip = require('pizzip');
  const Docxtemplater = require('docxtemplater');

  const tplPath = getTemplatePath();
  const content = fs.readFileSync(tplPath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  doc.render(prepareData(employee));

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { generateFromTemplate, getTemplatePath, prepareData, createDefaultTemplate };
