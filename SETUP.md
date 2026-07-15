# Настройка PostgreSQL

Проект переведён с SQLite на PostgreSQL. Для работы требуется запущенный сервер PostgreSQL.

## 1. Установите PostgreSQL

Если PostgreSQL ещё не установлен:

- **Windows**: https://www.postgresql.org/download/windows/
- **macOS**: `brew install postgresql`
- **Linux**: `sudo apt install postgresql` (Ubuntu/Debian)

Убедитесь, что сервер запущен.

## 2. Заполните .env

В файле `.env` укажите параметры подключения:

```env
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=portfolio
PG_USER=postgres
PG_PASSWORD=Admin1234!
```

> Пароль по умолчанию: `Admin1234!` — при желании смените.

## 3. Создайте базу данных

**Автоматически:**
```bash
node bin/setup-pg.js
```

**Вручную** (если скрипт не сработал):
```sql
-- Подключитесь к psql:
psql -U postgres

-- Создайте БД:
CREATE DATABASE portfolio;

-- Выйдите:
\q
```

## 4. Запустите сервер

```bash
npm start
```

При первом запуске сервер автоматически:
- Создаёт все таблицы (`employees`, `pending_changes`, `settings`, `employee_feedback`, `managers`, `sessions`)
- Создаёт менеджера по умолчанию: логин `admin`, пароль `Admin1234!`
- Заполняет базу тестовыми сотрудниками (если таблица пуста)

## Команды для восстановления (для разработчиков)

Полный сброс базы (удалить и создать заново):
```bash
node bin/setup-pg.js --reset
npm start
```

Только удалить базу:
```bash
node bin/setup-pg.js --drop
```

## Примечания

- Сессии теперь хранятся в PostgreSQL (таблица `sessions`)
- Все функции БД стали асинхронными (`async/await`)
- Используется пул соединений `pg.Pool`
- При ошибке подключения сервер не запустится (выведет сообщение в консоль)
