# NOTE: Build will fail because wb-blockchain is a local library

FROM node:lts-alpine AS builder

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

#####################

FROM node:lts-alpine

WORKDIR /usr/src/app
COPY --from=builder package.json package-lock.json dist/ ./
RUN npm ci --only=production
RUN apk add --no-cache tini
ENTRYPOINT [ "/sbin/tini", "--" ]
CMD [ "node", "dist/app.js" ]
