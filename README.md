🚀 Установка
Способ 1: Установка без Docker
1. Клонировать репозиторий
bash
git clone https://github.com/ваш-аккаунт/portfolio-system.git
cd portfolio-system
2. Установить зависимости
bash
npm install
3. Создать файл .env
bash
cp .env.example .env
4. Заполнить .env (см. раздел Переменные окружения)
bash
nano .env
# или
notepad .env
ВОЗМОЖНО ПОТРЕБУЕТСЯ СОЗДАТЬ ПАПКУ data
5. Запустить приложение
bash
npm start
Приложение будет доступно по адресу: http://localhost:3000
================================================================
Способ 2: Установка с Docker
1. Клонировать репозиторий
bash
git clone https://github.com/ваш-аккаунт/portfolio-system.git
cd portfolio-system
2. Создать файл .env
bash
cp .env.example .env
3. Заполнить .env (см. раздел Переменные окружения)
4. Собрать и запустить контейнер
bash
# Собрать образ
docker-compose build

# Запустить в фоновом режиме
docker-compose up -d
Приложение будет доступно по адресу: http://localhost:3000

5. Проверить логи
bash
docker logs portfolio-app