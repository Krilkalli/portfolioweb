#!/usr/bin/env node
const path = require('path');
const { helpers, initPromise, pool } = require('../server/db');
const { parseProjectExperienceFile } = require('../server/projectExperienceImport');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error('Укажите путь к файлу .xls или .xlsx');
  await initPromise;
  const parsed = parseProjectExperienceFile(path.resolve(filePath));
  const result = await helpers.importProjectExperience(parsed);
  console.log(JSON.stringify({
    ...result,
    sourceRows: parsed.totalRows,
    activeRows: parsed.activeRows,
    skippedInactiveRows: parsed.skippedInactiveRows,
    inactiveEmployees: parsed.inactiveEmployees.length,
  }, null, 2));
}

async function closeAndExit(code) {
  const fallback = setTimeout(() => process.exit(code), 1500);
  await pool.end().catch(() => {});
  clearTimeout(fallback);
  process.exit(code);
}

main().then(
  () => closeAndExit(0),
  error => {
    console.error(error.message || error);
    return closeAndExit(1);
  }
);
