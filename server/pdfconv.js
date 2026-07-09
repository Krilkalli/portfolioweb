const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { generateFromTemplate } = require('./templater');
const { generatePdfResume } = require('./pdfgen');

const SOFFICE_NAMES = process.platform === 'win32'
  ? [
      'soffice.exe',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
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
    } catch {}
  }
  return null;
}

const sofficePath = findSoffice();
const hasLibreOffice = !!sofficePath;

async function convertToPdf(employee) {
  // Option 1: LibreOffice -> perfect 1:1 conversion
  if (sofficePath) {
    try {
      const docxBuf = await generateFromTemplate(employee);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
      const docxPath = path.join(tmpDir, 'resume.docx');
      const pdfPath = path.join(tmpDir, 'resume.pdf');
      fs.writeFileSync(docxPath, docxBuf);
      await new Promise((resolve, reject) => {
        execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, docxPath], { timeout: 60000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      const pdfBuf = fs.readFileSync(pdfPath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return pdfBuf;
    } catch (e) {
      console.warn('LibreOffice conversion failed, falling back to pdfkit:', e.message);
    }
  }
  // Option 2: pdfkit (built-in, with Cyrillic via Arial)
  return generatePdfResume(employee);
}

module.exports = { convertToPdf, hasLibreOffice, sofficePath };
