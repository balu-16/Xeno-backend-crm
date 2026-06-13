# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Prisma generate ----
FROM deps AS prisma
COPY prisma ./prisma
RUN npx prisma generate

# ---- Build ----
FROM prisma AS build
COPY . .
RUN npm run build

# ---- Production (API) ----
FROM base AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
