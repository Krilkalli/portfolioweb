const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { generateFromTemplate } = require('./templater');
const { generatePdfResume } = require('./pdfgen');

const SOFFICE_NAMES = process.platform === 'win32'
  ? [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'soffice.exe',
      'soffice',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    ]
  : ['soffice', '/usr/bin/libreoffice', '/usr/bin/soffice'];

function findSoffice() {
  for (const name of SOFFICE_NAMES) {
    try {
      if (path.isAbsolute(name)) {
        if (fs.existsSync(name)) return name;
      } else {
        const sp = require('child_process').spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (sp.status === 0) return name;
      }
    } catch (e) {
      // skip
    }
  }
  return null;
}

const sofficePath = findSoffice();
const hasLibreOffice = !!sofficePath;

if (hasLibreOffice) {
  console.log(`PDF: LibreOffice найден: ${sofficePath}`);
} else {
  console.warn('PDF: LibreOffice не найден. Будет использован встроенный pdfkit (без шаблона).');
}

async function convertToPdf(employee) {
  if (sofficePath) {
    let tmpDir = null;
    try {
      const docxBuf = await generateFromTemplate(employee);
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
      const docxPath = path.join(tmpDir, 'resume.docx');
      const pdfPath = path.join(tmpDir, 'resume.pdf');
      fs.writeFileSync(docxPath, docxBuf);
      await new Promise((resolve, reject) => {
        execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, docxPath], { timeout: 60000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      if (!fs.existsSync(pdfPath)) {
        throw new Error('PDF файл не был создан');
      }
      const pdfBuf = fs.readFileSync(pdfPath);
      return pdfBuf;
    } catch (e) {
      console.warn('PDF: LibreOffice conversion failed:', e.message);
    } finally {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
    console.warn('PDF: fallback to pdfkit (template styling will be lost)');
  }
  return generatePdfResume(employee);
}

module.exports = { convertToPdf, hasLibreOffice, sofficePath };
