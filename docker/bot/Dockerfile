# syntax=docker/dockerfile:1

FROM node:current-alpine

RUN --mount=type=bind,source=./package.json,target=package.json \
    --mount=type=bind,source=./package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci

RUN adduser -s /bin/bash -D wheatley;echo 'wheatley:wheatley' | chpasswd

USER wheatley

WORKDIR /home/wheatley/bot

COPY . .

RUN npm run build

CMD ["node", "build/src/main.js"]
