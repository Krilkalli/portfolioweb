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

USER node

EXPOSE 3000

CMD ["node", "server/index.js"]
