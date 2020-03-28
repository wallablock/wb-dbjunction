# NOTE: Build will fail because wb-blockchain is a local library

FROM node:lts-alpine AS builder

COPY package.json package-lock.json ./
RUN npm ci --only=development
COPY . .
RUN npm run build

#####################

FROM node:lts-alpine

WORKDIR /usr/src/app
COPY --from=builder package.json package-lock.json dist/ ./
# Tini is a minimal init system, since Node does not handle this job well.
# Alternatively, we can force user to add the --init flag on docker run.
RUN apk add --no-cache tini
# {python, make, g++} temporarily installed to allow compilation of
# C++ extensions (e.g.: Ethereum hash algorithms have an optimized C++ version)
RUN apk add --no-cache --virtual .gyp python make g++ \
    && npm ci --only=production \
    && apk del .gyp
ENTRYPOINT [ "/sbin/tini", "--" ]
CMD [ "node", "dist/app.js" ]
