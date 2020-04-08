FROM node:lts-alpine

# Tini is a minimal init system, since Node does not handle this job well.
# Alternatively, we can force user to add the --init flag on docker run.
RUN apk add --no-cache tini

WORKDIR /usr/src/app

COPY . .

# {python, make, g++} temporarily installed to allow compilation of
# C++ extensions (e.g.: Ethereum hash algorithms have an optimized C++ version)
# Git is needed to download Wallablock dependencies (wb-blockchain, wb-contracts)
RUN apk add --no-cache --virtual .builddeps python make g++ git \
    && npm ci \
    && apk del .builddeps

RUN npm ci

ENTRYPOINT [ "/sbin/tini", "--" ]
CMD [ "node", "dist/app.js" ]
