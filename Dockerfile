# Metrolab backend (Express + PostgreSQL) container image for Cloud Run.
#
# node:20-slim (Debian, not Alpine) is used because native modules such as
# `muhammara` (PDF generation) ship prebuilt binaries that target glibc.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Cloud Run injects PORT (defaults to 8080); server.js already reads
# process.env.PORT, so no PORT env var is set here.
EXPOSE 8080

CMD ["node", "server.js"]
