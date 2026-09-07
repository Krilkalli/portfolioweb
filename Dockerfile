FROM node:20-alpine

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
RUN npm ci --omit=dev

# Копируем весь код
COPY --chown=node:node . .

# Каталоги нужны и при запуске без bind-mount. В Docker Compose права на
# смонтированные каталоги дополнительно исправляет сервис storage-init.
RUN mkdir -p /app/data /app/uploads \
 && chown -R node:node /app/data /app/uploads

USER node

EXPOSE 3000

CMD ["node", "server/index.js"]
