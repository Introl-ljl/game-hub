FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY backend ./backend
COPY db ./db
COPY scripts ./scripts
COPY public ./public
COPY server.js ./server.js
EXPOSE 3000
CMD ["node", "backend/server.mjs"]
