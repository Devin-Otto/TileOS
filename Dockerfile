FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY tileos.project.json ./
COPY public ./public
COPY data/seed.js ./data/seed.js

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=9273
ENV HOST=0.0.0.0
ENV TILEOS_DATA_ROOT=/data

EXPOSE 9273
VOLUME ["/data"]

CMD ["npm", "start"]
