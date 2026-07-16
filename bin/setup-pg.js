/**
 * Скрипт настройки PostgreSQL базы данных.
 *
 * Использование:
 *   node bin/setup-pg.js              — создать БД (если не существует)
 *   node bin/setup-pg.js --reset      — удалить и создать заново
 *   node bin/setup-pg.js --drop       — только удалить
 *
 * Перед запуском убедитесь, что PostgreSQL запущен,
 * а в .env указаны верные PG_HOST, PG_PORT, PG_USER, PG_PASSWORD.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const DB_NAME = process.env.PG_DATABASE || 'portfolio';
const PG_SUPERUSER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || '';
const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = parseInt(process.env.PG_PORT || '5432');

const args = process.argv.slice(2);
const shouldDrop = args.includes('--drop') || args.includes('--reset');
const shouldCreate = !args.includes('--drop') || args.includes('--reset');

async function main() {
  // Подключаемся к БД postgres (системная), чтобы управлять нашей БД
  const adminPool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    database: 'postgres',
    user: PG_SUPERUSER,
    password: PG_PASSWORD,
  });

  try {
    // Проверяем, существует ли БД
    const result = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [DB_NAME]
    );
    const exists = result.rows.length > 0;

    if (exists && shouldDrop) {
      console.log(`Удаляем базу данных "${DB_NAME}"...`);
      // Завершаем все подключения к целевой БД
      await adminPool.query(
        `SELECT pg_terminate_backend(pg_stat_activity.pid)
         FROM pg_stat_activity
         WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
        [DB_NAME]
      );
      await adminPool.query(`DROP DATABASE "${DB_NAME}"`);
      console.log(`✅ База данных "${DB_NAME}" удалена`);
    }

    if (!exists && shouldCreate) {
      console.log(`Создаём базу данных "${DB_NAME}"...`);
      await adminPool.query(`CREATE DATABASE "${DB_NAME}"`);
      console.log(`✅ База данных "${DB_NAME}" создана`);
    } else if (exists && shouldCreate) {
      console.log(`✅ База данных "${DB_NAME}" уже существует`);
    } else if (!exists && !shouldCreate) {
      console.log(`❌ База данных "${DB_NAME}" не найдена (--drop без --reset)`);
    }
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  } finally {
    await adminPool.end();
  }

  if (shouldCreate) {
    console.log(`\nГотово! Теперь запустите сервер:\n  npm start\n\nСервер сам создаст таблицы и заполнит начальными данными.`);
  }
}

main();
