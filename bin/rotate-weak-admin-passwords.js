const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, initPromise } = require('../server/db');

const WEAK_PASSWORDS = [
  'Admin1234!',
  'admin',
  'admin123',
  'password',
  'password123',
];

function temporaryPassword() {
  return `${crypto.randomBytes(18).toString('base64url')}!9aA`;
}

async function main() {
  await initPromise;
  const { rows } = await pool.query(
    "SELECT id, email, password_hash FROM managers WHERE role = 'admin' ORDER BY id"
  );
  const rotated = [];

  for (const manager of rows) {
    const isWeak = WEAK_PASSWORDS.some(password => bcrypt.compareSync(password, manager.password_hash));
    if (!isWeak) continue;
    const password = temporaryPassword();
    const hash = bcrypt.hashSync(password, 12);
    await pool.query('UPDATE managers SET password_hash = $1 WHERE id = $2', [hash, manager.id]);
    await pool.query("DELETE FROM sessions WHERE NULLIF(sess::jsonb ->> 'managerId', '')::int = $1", [manager.id]);
    rotated.push({ email: manager.email, temporaryPassword: password });
  }

  if (!rotated.length) {
    console.log('Слабые стандартные пароли администраторов не обнаружены.');
    return;
  }

  const outputPath = path.join(__dirname, '..', 'data', '.admin-reset-password.json');
  fs.writeFileSync(outputPath, `${JSON.stringify({ createdAt: new Date().toISOString(), accounts: rotated }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  console.log(`Пароли ${rotated.length} учётных записей заменены. Временные данные сохранены в data/.admin-reset-password.json`);
}

main()
  .catch(error => {
    console.error('Не удалось выполнить ротацию:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
