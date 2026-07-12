const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const path = require('path');
const fs = require('fs');
const { prepareData } = require('./templater');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');

function registerFonts(doc) {
  const regular = path.join(FONTS_DIR, 'arial.ttf');
  const bold = path.join(FONTS_DIR, 'arialbd.ttf');
  if (fs.existsSync(regular)) doc.registerFont('MainFont', regular);
  else doc.registerFont('MainFont', 'Helvetica');
  if (fs.existsSync(bold)) doc.registerFont('MainFontBold', bold);
  else doc.registerFont('MainFontBold', 'Helvetica');
}

function parsePhoto(base64Str) {
  if (!base64Str || !base64Str.startsWith('data:image/')) return null;
  const m = base64Str.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
  if (!m) return null;
  try { return Buffer.from(m[2], 'base64'); } catch { return null; }
}

async function generatePdfResume(employee) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 55, right: 55 },
      bufferPages: true,
      info: {
        Title: `Резюме — ${employee.name}`,
        Author: 'Портфолио IS1C',
      },
    });
    registerFonts(doc);

    const stream = new PassThrough();
    const chunks = [];
    doc.pipe(stream);
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    const ml = 55;
    const maxW = doc.page.width - ml * 2;
    let y = ml;

    // ── Header: photo + name + position + contacts ─────────────────────
    const photoBuf = parsePhoto(employee.photo);
    const nameX = photoBuf ? ml + 90 : ml;
    const nameW = maxW - (photoBuf ? 95 : 0);

    if (photoBuf) {
      try {
        doc.image(photoBuf, ml, y, { width: 80, height: 80 });
      } catch {}
    }

    doc.font('MainFontBold').fontSize(18).fillColor('#1A1A2E');
    doc.text(employee.name || '', nameX, y + 5, { width: nameW });
    y += doc.heightOfString(employee.name, { width: nameW }) + 10;

    doc.font('MainFontBold').fontSize(13).fillColor('#6C63FF');
    doc.text(employee.position || '', nameX, y, { width: nameW });
    y += doc.heightOfString(employee.position || '', { width: nameW }) + 8;

    const contacts = (employee.contacts || '').split('\n').filter(l => l.trim());
    if (contacts.length > 0) {
      doc.font('MainFont').fontSize(9).fillColor('#666666');
      doc.text(contacts.join(' | '), nameX, y, { width: nameW });
      y += doc.heightOfString(contacts.join(' | '), { width: nameW }) + 8;
    }

    y = Math.max(y, ml + 95);

    // ── Divider ────────────────────────────────────────────────────────
    doc.strokeColor('#6C63FF').lineWidth(1.5);
    doc.moveTo(ml, y).lineTo(doc.page.width - ml, y).stroke();
    y += 16;

    // ── Sections ───────────────────────────────────────────────────────
    const addSection = (title, content) => {
      if (!content || !content.trim()) {
        doc.font('MainFont').fontSize(10).fillColor('#999999');
        doc.text('—', ml, y, { width: maxW });
        y += 14;
        return;
      }
      y += 8;
      doc.font('MainFontBold').fontSize(11).fillColor('#6C63FF');
      doc.text(title.toUpperCase(), ml, y);
      doc.strokeColor('#6C63FF').lineWidth(0.8);
      doc.moveTo(ml, y + 14).lineTo(ml + doc.widthOfString(title.toUpperCase()) + 10, y + 14).stroke();
      y += 24;
      doc.font('MainFont').fontSize(10).fillColor('#333333');
      doc.text(content, ml, y, { width: maxW, lineGap: 2 });
      y += doc.heightOfString(content, { width: maxW, lineGap: 2 }) + 8;
    };

    const data = prepareData(employee);
    addSection('Обо мне', data.about);
    addSection('Ключевые компетенции', data.competencies);
    addSection('Стаж работы', data.experience);
    addSection('Проектный опыт', data.project_experience);
    addSection('Образование', data.education);
    addSection('Сертификаты 1С', data.certification);

    doc.end();
  });
}

module.exports = { generatePdfResume };