FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
# ffmpeg: video posters, Live/Motion Photo clips, GIFs, HEVC→H.264
# libheif-tools: HEIC decoding (sharp's bundled libvips can't do HEVC)
# exiftool: Apple ContentIdentifier for pairing Live Photo halves
# curl: Coolify's health check
RUN apk add --no-cache openssl curl ffmpeg libheif-tools exiftool \
 && npm install -g prisma@6.19.3 \
 && npm cache clean --force
WORKDIR /app
ENV NODE_ENV=production
ENV PHOTOS_DIR=/photos
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/photos /photos
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
