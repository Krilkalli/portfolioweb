FROM node:18-alpine

# Устанавливаем Python и компилятор для better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production

# Копируем весь код
COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]