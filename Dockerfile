# syntax=docker/dockerfile:1
# datasteg money-flow: the Next.js standalone server (app/), the Sinho design system (design/) and every public
# release of the site data (release/, copied from the release store and scanned by the
# licence check, scripts/check_release.py, before the build). The image holds nothing private: release/ has derived marks and aggregates only.
FROM --platform=$BUILDPLATFORM node:24.22.0-alpine AS build
WORKDIR /repo/app
RUN npm install -g pnpm@11.18.0 >/dev/null
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm fetch
COPY design /repo/design
COPY app /repo/app
RUN pnpm install --offline --frozen-lockfile
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION NEXT_TELEMETRY_DISABLED=1
RUN BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) pnpm build

FROM node:24.22.0-alpine
WORKDIR /srv
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 APP_VERSION=$APP_VERSION
COPY --from=build /repo/app/.next/standalone ./
COPY --from=build /repo/app/.next/static ./app/.next/static
COPY --from=build /repo/app/public ./app/public
# The release store: objects by content hash and one manifest per release, read by app/lib/data.ts.
COPY release ./site
ENV SITE_DIR=/srv/site
USER 10071:10071
EXPOSE 8080
CMD ["node", "app/server.js"]
