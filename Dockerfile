# One image runs one instance. Build: docker build -t eventos .   Run with docker-compose.yml.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
RUN mkdir -p .data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
