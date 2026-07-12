const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, BorderStyle, AlignmentType, WidthType } = require('docx');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const DEFAULT_TEMPLATE = path.join(TEMPLATES_DIR, 'resume_template.docx');
const LOGO_PATH = path.join(TEMPLATES_DIR, 'default_logo.png');

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

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function createDefaultLogo() {
  if (fs.existsSync(LOGO_PATH)) return;
  const w = 200, h = 60;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ratio = x / w;
      if (ratio < 0.4) {
        px[i] = 26; px[i+1] = 26; px[i+2] = 46; px[i+3] = 255;
      } else if (ratio > 0.6) {
        px[i] = 108; px[i+1] = 99; px[i+2] = 255; px[i+3] = 255;
      } else {
        const t = (ratio - 0.4) / 0.2;
        px[i] = Math.round(26 + (108 - 26) * t);
        px[i+1] = Math.round(26 + (99 - 26) * t);
        px[i+2] = Math.round(46 + (255 - 46) * t);
        px[i+3] = 255;
      }
    }
  }
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (w * 4 + 1) + 1 + x * 4;
      raw[dst] = px[src]; raw[dst+1] = px[src+1]; raw[dst+2] = px[src+2]; raw[dst+3] = px[src+3];
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(LOGO_PATH, png);
}

function sectionHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: '6C63FF', font: 'Calibri' })],
    spacing: { before: 300, after: 100 },
    border: { bottom: { color: '6C63FF', size: 4, style: BorderStyle.SINGLE } },
  });
}

function sectionContent(placeholder) {
  return new Paragraph({
    children: [new TextRun({ text: placeholder, size: 22, font: 'Calibri', color: '333333' })],
    spacing: { after: 80 },
  });
}

function imageFromBase64(base64) {
  if (!base64 || !base64.startsWith('data:')) return null;
  const matches = base64.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
  if (!matches) return null;
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const data = Buffer.from(matches[2], 'base64');
  const size = 120;
  return { data, ext, size, width: size, height: size };
}

async function createDefaultTemplate() {
  createDefaultLogo();
  const logoData = fs.readFileSync(LOGO_PATH);

  const children = [
    // ── Header: photo + logo + personal info in a table ─────────────────
    new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 15, type: WidthType.PERCENTAGE },
              verticalAlign: 'center',
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [
                new Paragraph({
                  children: [
                    new ImageRun({ data: logoData, transformation: { width: 100, height: 30 } }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: '{photo}', size: 1, color: 'FFFFFF' })],
                  spacing: { before: 0, after: 0 },
                }),
              ],
            }),
            new TableCell({
              width: { size: 85, type: WidthType.PERCENTAGE },
              verticalAlign: 'center',
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [
                new Paragraph({ children: [new TextRun({ text: '{name}', bold: true, size: 36, font: 'Calibri', color: '1A1A2E' })], spacing: { after: 40 } }),
                new Paragraph({ children: [new TextRun({ text: '{position}', size: 24, color: '6C63FF', font: 'Calibri', bold: true })], spacing: { after: 40 } }),
                new Paragraph({ children: [new TextRun({ text: '{contacts}', size: 18, color: '666666', font: 'Calibri' })], spacing: { after: 0 } }),
              ],
            }),
          ],
        }),
      ],
    }),

    // ── Divider ───────────────────────────────────────────────────────────
    new Paragraph({
      border: { bottom: { color: '6C63FF', size: 8, style: BorderStyle.SINGLE } },
      spacing: { before: 200, after: 200 },
      children: [],
    }),

    // ── Sections ──────────────────────────────────────────────────────────
    sectionHeader('Обо мне'),
    sectionContent('{about}'),

    sectionHeader('Ключевые компетенции'),
    sectionContent('{competencies}'),

    sectionHeader('Стаж работы'),
    sectionContent('{experience}'),

    sectionHeader('Проектный опыт'),
    sectionContent('{project_experience}'),

    sectionHeader('Образование'),
    sectionContent('{education}'),

    sectionHeader('Сертификаты 1С'),
    sectionContent('{certification}'),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '333333' },
        },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } } },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(DEFAULT_TEMPLATE, buf);
  console.log('✅ Создан базовый шаблон с логотипом:', DEFAULT_TEMPLATE);
}

if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
createDefaultLogo();
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
    photo: employee.photo || '',
  };
}

function parsePhoto(base64Str) {
  if (!base64Str || !base64Str.startsWith('data:image/')) return null;
  const m = base64Str.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return Buffer.from(m[2], 'base64');
}

async function generateFromTemplate(employee) {
  const tplPath = getTemplatePath();
  const isDefault = tplPath === DEFAULT_TEMPLATE;

  // Default template: generate directly for full control (photo, layout)
  if (isDefault) return generateDocx(employee);

  // Custom template: use docxtemplater
  const PizZip = require('pizzip');
  const Docxtemplater = require('docxtemplater');
  const content = fs.readFileSync(tplPath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(prepareData(employee));
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function generateDocx(employee) {
  const logoData = fs.readFileSync(LOGO_PATH);
  const photoBuf = parsePhoto(employee.photo);

  const childParagraphs = [];

  // ── Header: photo (if exists) + logo + personal info ─────────────────
  const infoChildren = [
    new Paragraph({ children: [new TextRun({ text: employee.name || '', bold: true, size: 36, font: 'Calibri', color: '1A1A2E' })], spacing: { after: 40 } }),
    new Paragraph({ children: [new TextRun({ text: employee.position || '', size: 24, color: '6C63FF', font: 'Calibri', bold: true })], spacing: { after: 40 } }),
    new Paragraph({ children: [new TextRun({ text: (employee.contacts || '').split('\n').filter(l => l.trim()).join(' | '), size: 18, color: '666666', font: 'Calibri' })], spacing: { after: 0 } }),
  ];
  const infoCell = new TableCell({
    width: { size: photoBuf ? 70 : 75, type: WidthType.PERCENTAGE },
    verticalAlign: 'center',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: infoChildren,
  });
  const cells = [
    new TableCell({
      width: { size: photoBuf ? 15 : 25, type: WidthType.PERCENTAGE },
      verticalAlign: 'center',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [
        new Paragraph({
          children: [new ImageRun({ data: logoData, transformation: { width: 100, height: 30 } })],
          alignment: AlignmentType.CENTER,
        }),
      ],
    }),
  ];
  if (photoBuf) {
    cells.unshift(new TableCell({
      width: { size: 15, type: WidthType.PERCENTAGE },
      verticalAlign: 'center',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ data: photoBuf, transformation: { width: 80, height: 80 } })],
      })],
    }));
  }
  cells.push(infoCell);
  childParagraphs.push(new Table({
    rows: [new TableRow({ children: cells })],
  }));

  const addSection = (title, content) => {
    childParagraphs.push(sectionHeader(title));
    childParagraphs.push(sectionContent(content || '—'));
  };

  childParagraphs.push(new Paragraph({
    border: { bottom: { color: '6C63FF', size: 8, style: BorderStyle.SINGLE } },
    spacing: { before: 200, after: 200 },
    children: [],
  }));

  addSection('Обо мне', employee.about);
  addSection('Ключевые компетенции', employee.competencies);
  addSection('Стаж работы', formatExperience(employee.experience));
  addSection('Проектный опыт', formatProject(employee.project_experience));
  addSection('Образование', formatEducation(employee.education));
  addSection('Сертификаты 1С', formatCertification(employee.certification));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '333333' },
        },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } } },
      children: childParagraphs,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateFromTemplate, generateDocx, getTemplatePath, prepareData, createDefaultTemplate };
