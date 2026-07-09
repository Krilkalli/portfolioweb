const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const path = require('path');
const fs = require('fs');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');

const FONT_REGULAR = 'MainFont';
const FONT_BOLD = 'MainFontBold';

function registerFonts(doc) {
  const regular = path.join(FONTS_DIR, 'arial.ttf');
  const bold = path.join(FONTS_DIR, 'arialbd.ttf');
  if (fs.existsSync(regular)) doc.registerFont(FONT_REGULAR, regular);
  else doc.registerFont(FONT_REGULAR, 'Helvetica');
  if (fs.existsSync(bold)) doc.registerFont(FONT_BOLD, bold);
  else doc.registerFont(FONT_BOLD, 'Helvetica');
}

const BRAND_DARK = [26, 26, 46];
const BRAND_ACCENT = [108, 99, 255];
const GRAY = [102, 102, 102];
const BLACK = [51, 51, 51];

function drawDivider(doc, y, margin) {
  doc.save();
  doc.strokeColor(...BRAND_ACCENT);
  doc.lineWidth(1.5);
  doc.moveTo(margin, y);
  doc.lineTo(doc.page.width - margin, y);
  doc.stroke();
  doc.restore();
  return y + 20;
}

function drawSectionHeader(doc, text, y, margin) {
  doc.save();
  doc.font(FONT_BOLD).fontSize(10).fillColor(...BRAND_ACCENT);
  doc.text(text.toUpperCase(), margin, y);
  const textWidth = doc.widthOfString(text.toUpperCase());
  doc.strokeColor(...BRAND_ACCENT);
  doc.lineWidth(0.8);
  doc.moveTo(margin, y + 15);
  doc.lineTo(margin + textWidth + 10, y + 15);
  doc.stroke();
  doc.restore();
  return y + 30;
}

function wrapText(doc, text, y, margin, opts = {}) {
  if (!text || !text.trim()) {
    doc.save();
    doc.font(opts.bold ? FONT_BOLD : FONT_REGULAR).fontSize(opts.fontSize || 10).fillColor(...GRAY);
    doc.text('—', margin, y);
    doc.restore();
    return y + 14;
  }
  doc.save();
  doc.font(opts.bold ? FONT_BOLD : FONT_REGULAR).fontSize(opts.fontSize || 10).fillColor(...(opts.color || BLACK));
  const maxWidth = doc.page.width - margin * 2;
  const height = doc.heightOfString(text, { width: maxWidth, lineGap: 2 });
  if (y + height > doc.page.height - margin) {
    doc.addPage();
    y = margin;
  }
  doc.text(text, margin, y, { width: maxWidth, lineGap: 2 });
  doc.restore();
  return y + height + 6;
}

function ensurePage(doc, y, margin, needed = 60) {
  if (y + needed > doc.page.height - margin) {
    doc.addPage();
    return margin;
  }
  return y;
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

    const margin = 55;
    let y = margin;

    doc.font(FONT_BOLD).fontSize(20).fillColor(...BRAND_DARK);
    doc.text(employee.name, margin, y, { width: doc.page.width - margin * 2 });
    y += doc.heightOfString(employee.name, { width: doc.page.width - margin * 2 }) + 6;

    doc.font(FONT_BOLD).fontSize(14).fillColor(...BRAND_ACCENT);
    doc.text(employee.position || '', margin, y, { width: doc.page.width - margin * 2 });
    y += doc.heightOfString(employee.position || '', { width: doc.page.width - margin * 2 }) + 8;

    const contacts = (employee.contacts || '').split('\n').filter(l => l.trim());
    if (contacts.length > 0) {
      doc.font(FONT_REGULAR).fontSize(9).fillColor(...GRAY);
      const contactLine = contacts.join('   |   ');
      doc.text(contactLine, margin, y, { width: doc.page.width - margin * 2 });
      y += doc.heightOfString(contactLine, { width: doc.page.width - margin * 2 }) + 8;
    }

    y = drawDivider(doc, y, margin);

    if (employee.about && employee.about.trim()) {
      y = ensurePage(doc, y, margin, 60);
      y = drawSectionHeader(doc, 'Обо мне', y, margin);
      y = wrapText(doc, employee.about, y, margin);
    }

    if (employee.competencies && employee.competencies.trim()) {
      y = ensurePage(doc, y, margin, 60);
      y = drawSectionHeader(doc, 'Ключевые компетенции', y, margin);
      const lines = employee.competencies.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const cleaned = line.replace(/^[-•–]\s*/, '');
        doc.save();
        doc.fillColor(...BRAND_ACCENT);
        doc.circle(margin + 6, y + 4, 2.5).fill();
        doc.restore();
        y = wrapText(doc, cleaned, y, margin, { indent: 18 });
      }
    }

    if (employee.experience) {
      y = ensurePage(doc, y, margin, 60);
      y = drawSectionHeader(doc, 'Стаж работы', y, margin);
      if (typeof employee.experience === 'object' && !Array.isArray(employee.experience)) {
        if (employee.experience.total) {
          y = wrapText(doc, `Общий стаж: ${employee.experience.total}`, y, margin, { bold: true, color: BRAND_DARK });
        }
        if (Array.isArray(employee.experience.jobs) && employee.experience.jobs.length > 0) {
          y = wrapText(doc, 'Стаж работы в 1С:', y, margin, { bold: true, color: BRAND_DARK });
          for (const job of employee.experience.jobs) {
            const parts = [];
            if (job.company) parts.push('Компания: ' + job.company);
            if (job.position) parts.push('Должность: ' + job.position);
            if (job.period) parts.push(job.period);
            if (parts.length) {
              y = ensurePage(doc, y, margin);
              y = wrapText(doc, parts.join(' | '), y, margin);
            }
          }
        }
      } else {
        y = wrapText(doc, String(employee.experience), y, margin);
      }
    }

    const hasProjects = employee.project_experience &&
      ((Array.isArray(employee.project_experience) && employee.project_experience.length > 0) ||
       (typeof employee.project_experience === 'string' && employee.project_experience.trim()));
    if (hasProjects) {
      y = ensurePage(doc, y, margin, 60);
      y = drawSectionHeader(doc, 'Проектный опыт', y, margin);
      if (typeof employee.project_experience === 'string') {
        const blocks = employee.project_experience.split(/\n\s*\n/);
        for (const block of blocks) {
          if (!block.trim()) continue;
          const lines = block.split('\n').filter(l => l.trim());
          for (const line of lines) {
            const isLabel = /^(Клиент|Продукт|Продукты|Области внедрения|Роль|Размер команды|Описание проекта|Обязанности|Окружение):/.test(line);
            y = ensurePage(doc, y, margin);
            y = wrapText(doc, line, y, margin, { bold: isLabel, color: isLabel ? BRAND_DARK : undefined });
          }
          y += 8;
        }
      } else {
        const fieldLabels = {
          period: 'Период', position: 'Должность', role: 'Роль',
          team_size: 'Размер команды', client: 'Заказчик',
          project_description: 'Описание проекта',
          task_description: 'Задача сотрудника', technologies: 'Технологии',
        };
        for (const proj of employee.project_experience) {
          for (const [key, label] of Object.entries(fieldLabels)) {
            if (proj[key]) {
              y = ensurePage(doc, y, margin);
              y = wrapText(doc, `${label}: ${proj[key]}`, y, margin, { bold: true, color: BRAND_DARK });
            }
          }
          y += 8;
        }
      }
    }

    if (employee.education && employee.education.length > 0) {
      y = ensurePage(doc, y, margin, 60);
      y = drawSectionHeader(doc, 'Образование', y, margin);
      if (typeof employee.education === 'string') {
        y = wrapText(doc, employee.education, y, margin);
      } else {
        for (const edu of employee.education) {
          const parts = [edu.institution, edu.degree, edu.specialty, edu.year].filter(Boolean);
          if (parts.length > 0) {
            y = ensurePage(doc, y, margin);
            y = wrapText(doc, parts.join('\n'), y, margin);
          }
        }
      }
    }

    if (employee.certification && employee.certification.trim()) {
      y = ensurePage(doc, y, margin, 60);
      y = drawSectionHeader(doc, 'Сертификаты 1С', y, margin);
      const certLines = employee.certification.split('\n')
        .filter(l => l.trim() && !l.includes('Сертификация 1С:') && l !== '-');
      if (certLines.length > 0) {
        for (const line of certLines) {
          const cleaned = line.replace(/^[-•]\s*/, '').replace(/;$/, '');
          y = ensurePage(doc, y, margin);
          doc.save();
          doc.fillColor(...BRAND_ACCENT);
          doc.circle(margin + 6, y + 4, 2.5).fill();
          doc.restore();
          y = wrapText(doc, cleaned, y, margin, { indent: 18 });
        }
      } else {
        y = wrapText(doc, '—', y, margin, { color: GRAY });
      }
    }

    doc.end();
  });
}

module.exports = { generatePdfResume };
