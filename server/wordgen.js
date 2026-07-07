const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, HeadingLevel,
  ShadingType, VerticalAlign, Header, ImageRun,
} = require('docx');

const FIELD_LABELS = {
  name: 'ФИО',
  education: 'Образование',
  position: 'Должность',
  contacts: 'Контактные данные',
  experience: 'Стаж работы',
  about: 'Обо мне',
  competencies: 'Компетенции',
  project_experience: 'Проектный опыт',
  certification: 'Сертификация 1С',
};

// Цвета IS1C
const BRAND_DARK = '1A1A2E';
const BRAND_ACCENT = '6C63FF';
const BRAND_LIGHT = 'F0EEFF';
const GRAY = '666666';

function makeHeading(text, level = 'HEADING_2') {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: level === 'HEADING_1' ? 32 : 24, color: BRAND_DARK })],
    spacing: { before: 200, after: 100 },
  });
}

function makeParagraph(text, opts = {}) {
  if (!text) return new Paragraph({ children: [new TextRun({ text: '—' })] });
  return new Paragraph({
    children: text.split('\n').flatMap((line, i) => [
      ...(i > 0 ? [new TextRun({ break: 1 })] : []),
      new TextRun({ text: line, ...opts }),
    ]),
    spacing: { after: 80 },
  });
}

function makeDivider() {
  return new Paragraph({
    border: { bottom: { color: BRAND_ACCENT, size: 6, style: BorderStyle.SINGLE } },
    spacing: { before: 120, after: 120 },
    children: [],
  });
}

function makeBulletList(text) {
  if (!text) return [new Paragraph({ children: [new TextRun({ text: '—', color: GRAY })] })];
  return text.split('\n').filter(l => l.trim()).map(line => {
    const cleaned = line.replace(/^[-•–]\s*/, '');
    return new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: cleaned })],
      spacing: { after: 60 },
    });
  });
}

function makeSectionHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: BRAND_ACCENT, allCaps: true })],
    spacing: { before: 300, after: 100 },
    border: { bottom: { color: BRAND_ACCENT, size: 4, style: BorderStyle.SINGLE } },
  });
}

async function generateResume(employee) {
  const sections = [];

  // ── Шапка: ФИО + должность + контакты ──────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: employee.name, bold: true, size: 40, color: BRAND_DARK })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: employee.position, size: 28, color: BRAND_ACCENT, bold: true })],
      spacing: { after: 80 },
    }),
  );

  // Контакты
  const contacts = (employee.contacts || '').split('\n').filter(l => l.trim());
  const contactLine = contacts.join('   |   ');
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: contactLine, color: GRAY, size: 18 })],
      spacing: { after: 200 },
    }),
    makeDivider(),
  );

  // ── Обо мне ─────────────────────────────────────────────────────────────────
  if (employee.about && employee.about.trim()) {
    sections.push(makeSectionHeader('Обо мне'), makeParagraph(employee.about));
  }

  // ── Ключевые компетенции ────────────────────────────────────────────────────
  if (employee.competencies && employee.competencies.trim()) {
    sections.push(makeSectionHeader('Ключевые компетенции'));
    sections.push(...makeBulletList(employee.competencies));
  }

  // ── Стаж работы ─────────────────────────────────────────────────────────────
  if (employee.experience) {
    sections.push(makeSectionHeader('Стаж работы'));
    if (typeof employee.experience === 'object' && !Array.isArray(employee.experience)) {
      if (employee.experience.total) {
        sections.push(new Paragraph({
          children: [new TextRun({ text: 'Общий стаж: ', bold: true, color: BRAND_DARK }), new TextRun({ text: employee.experience.total })],
          spacing: { after: 80 },
        }));
      }
      if (Array.isArray(employee.experience.jobs) && employee.experience.jobs.length > 0) {
        sections.push(new Paragraph({
          children: [new TextRun({ text: 'Стаж работы в 1С:', bold: true, color: BRAND_DARK })],
          spacing: { after: 60 },
        }));
        for (const job of employee.experience.jobs) {
          const parts = [];
          if (job.company) parts.push('Компания: ' + job.company);
          if (job.position) parts.push('Должность: ' + job.position);
          if (job.period) parts.push(job.period);
          if (parts.length) sections.push(makeParagraph(parts.join(' | ')));
        }
      }
    } else {
      sections.push(makeParagraph(String(employee.experience)));
    }
  }

  // ── Проектный опыт ──────────────────────────────────────────────────────────
  if (employee.project_experience && (Array.isArray(employee.project_experience) && employee.project_experience.length > 0 || typeof employee.project_experience === 'string' && employee.project_experience.trim())) {
    sections.push(makeSectionHeader('Проектный опыт'));
    if (typeof employee.project_experience === 'string') {
      const blocks = employee.project_experience.split(/\n\s*\n/);
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const isLabel = /^(Клиент|Продукт|Продукты|Области внедрения|Роль|Размер команды|Описание проекта|Обязанности|Окружение):/.test(line);
          sections.push(new Paragraph({
            children: [new TextRun({ text: line, bold: isLabel, color: isLabel ? BRAND_DARK : undefined })],
            spacing: { after: 60 },
          }));
        }
        sections.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      }
    } else {
      for (const proj of employee.project_experience) {
        const fields = [
          { label: 'Период', key: 'period' },
          { label: 'Должность', key: 'position' },
          { label: 'Роль', key: 'role' },
          { label: 'Размер команды', key: 'team_size' },
          { label: 'Заказчик', key: 'client' },
          { label: 'Описание проекта', key: 'project_description' },
          { label: 'Задача сотрудника', key: 'task_description' },
          { label: 'Технологии', key: 'technologies' },
        ];
        for (const f of fields) {
          if (proj[f.key]) sections.push(new Paragraph({
            children: [new TextRun({ text: f.label + ': ', bold: true, color: BRAND_DARK }), new TextRun({ text: proj[f.key] })],
            spacing: { after: 60 },
          }));
        }
        sections.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      }
    }
  }

  // ── Образование ─────────────────────────────────────────────────────────────
  if (employee.education && employee.education.length > 0) {
    sections.push(makeSectionHeader('Образование'));
    if (typeof employee.education === 'string') {
      sections.push(makeParagraph(employee.education));
    } else {
      for (const edu of employee.education) {
        const parts = [edu.institution, edu.degree, edu.specialty, edu.year].filter(Boolean);
        if (parts.length > 0) sections.push(makeParagraph(parts.join('\n')));
        sections.push(new Paragraph({ children: [], spacing: { after: 80 } }));
      }
    }
  }

  // ── Сертификация 1С ─────────────────────────────────────────────────────────
  if (employee.certification && employee.certification.trim()) {
    sections.push(makeSectionHeader('Сертификаты 1С'));
    const certLines = employee.certification.split('\n').filter(l => l.trim() && !l.includes('Сертификация 1С:') && l !== '-');
    if (certLines.length > 0) {
      sections.push(...certLines.map(line => new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: line.replace(/^[-•]\s*/, '').replace(/;$/, '') })],
        spacing: { after: 60 },
      })));
    } else {
      sections.push(makeParagraph('—'));
    }
  }

  // ── Документ ────────────────────────────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '333333' },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 900 },
        },
      },
      children: sections,
    }],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateResume, FIELD_LABELS };
