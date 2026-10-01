FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_PRODUCTION=1
ENV VITE_PRODUCTION=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/src/db ./src/db
COPY --from=build /app/server.mjs ./server.mjs
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "server.mjs"]
