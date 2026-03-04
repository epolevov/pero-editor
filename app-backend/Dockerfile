FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json ./
COPY moleculer.config.ts ./
COPY src ./src

RUN npm run build

EXPOSE 8080

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
