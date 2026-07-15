FROM node:18-alpine

# Устанавливаем Python и компилятор для better-sqlite3
RUN apk add --no-cache python3 make g++

# Устанавливаем LibreOffice (для конвертации docx -> pdf) и шрифты с поддержкой кириллицы
# (кириллица уже входит в font-dejavu / font-liberation / font-noto, отдельный пакет не нужен)
RUN apk add --no-cache \
    libreoffice-writer \
    fontconfig \
    font-dejavu \
    font-liberation \
    font-noto \
 && fc-cache -f

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production

# Копируем весь код
COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]