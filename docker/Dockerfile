###########################
#     BASE CONTAINER      #
###########################
FROM node:24-alpine3.23 AS base

ENV HTTP_PROXY=""
ENV HTTPS_PROXY=""
ENV http_proxy=""
ENV https_proxy=""
ENV NO_PROXY="*"
ENV no_proxy="*"

RUN sed -i 's|https://|http://|g' /etc/apk/repositories
RUN apk add --no-cache openssl ca-certificates font-freefont && update-ca-certificates


###########################
#    BUILDER CONTAINER    #
###########################
FROM base AS builder

ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false
RUN apk add --no-cache libc6-compat jq
WORKDIR /app

COPY . .

# Install the exact turbo version resolved in the lockfile, without installing
# the rest of the dependency tree (prune must run before any npm ci).
RUN TURBO_VERSION="$(jq -r '.packages["node_modules/turbo"].version' package-lock.json)" \
    && npm install -g "turbo@${TURBO_VERSION}"

# Outputs to the /out folder
# source: https://turbo.build/repo/docs/reference/command-line-reference/prune#--docker
RUN turbo prune --scope=@documenso/remix --docker

###########################
#   INSTALLER CONTAINER   #
###########################
FROM base AS installer

ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false
RUN apk add --no-cache libc6-compat jq make cmake g++ openssl bash

WORKDIR /app

# Disable husky from installing hooks
ENV HUSKY=0
ENV DOCKER_OUTPUT=1
ENV NEXT_TELEMETRY_DISABLED=1

# Encryption keys
ARG NEXT_PRIVATE_ENCRYPTION_KEY="CAFEBABE"
ENV NEXT_PRIVATE_ENCRYPTION_KEY="$NEXT_PRIVATE_ENCRYPTION_KEY"

ARG NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY="DEADBEEF"
ENV NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY="$NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY"

# Sub-path the app is served under (e.g. "/ESign"). Empty = root.
# Baked into the client bundle by Vite/React Router at build time; also
# required at runtime for SSR so window.__ENV__ exposes it to the client.
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH="$NEXT_PUBLIC_BASE_PATH"

# Telemetry credentials (optional, baked into image at build time)
ARG NEXT_PRIVATE_TELEMETRY_KEY=""
ENV NEXT_PRIVATE_TELEMETRY_KEY="$NEXT_PRIVATE_TELEMETRY_KEY"

ARG NEXT_PRIVATE_TELEMETRY_HOST=""
ENV NEXT_PRIVATE_TELEMETRY_HOST="$NEXT_PRIVATE_TELEMETRY_HOST"


# Uncomment and use build args to enable remote caching
# ARG TURBO_TEAM
# ENV TURBO_TEAM=$TURBO_TEAM
# ARG TURBO_TOKEN
# ENV TURBO_TOKEN=$TURBO_TOKEN

# First install the dependencies (as they change less often)
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json

COPY --from=builder /app/lingui.config.ts ./lingui.config.ts
COPY --from=builder /app/patches ./patches

RUN npm ci

# Then copy all the source code (as it changes more often)
COPY --from=builder /app/out/full/ .
# Finally copy the turbo.json file so that we can run turbo commands
COPY turbo.json turbo.json

ENV NODE_OPTIONS="--max-old-space-size=8192"

RUN npx turbo run build --filter=@documenso/remix...

###########################
#     RUNNER CONTAINER    #
###########################
FROM base AS runner

ENV HUSKY=0
ENV DOCKER_OUTPUT=1
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false

# Office-to-PDF conversion dependency. The on-the-fly DOCX/DOC -> PDF pipeline
# (packages/lib/server-only/utils/convert-to-pdf.ts) shells out to LibreOffice's
# `soffice --headless`; without it `findBinary('soffice')` throws DEPENDENCY_MISSING
# and Word document uploads fail. libreoffice-writer pulls in libreoffice-common
# which provides /usr/bin/soffice; font-liberation supplies the metric-compatible
# Arial/Times/Courier substitutes Word documents rely on.
#
# Encrypted-PDF dependency. normalizePdf (packages/lib/server-only/pdf/normalize-pdf.ts)
# detects pdfDoc.isEncrypted and calls decryptPdf (packages/lib/server-only/utils/decrypt-pdf.ts),
# which shells out to `qpdf --decrypt`; without it `findBinary('qpdf')` throws
# DEPENDENCY_MISSING and every encrypted/password-protected PDF upload fails. qpdf
# provides /usr/bin/qpdf.
RUN apk add --no-cache libreoffice-writer font-liberation qpdf

# Telemetry credentials (baked into image at build time, can be disabled at runtime)
ARG NEXT_PRIVATE_TELEMETRY_KEY=""
ENV NEXT_PRIVATE_TELEMETRY_KEY="$NEXT_PRIVATE_TELEMETRY_KEY"

ARG NEXT_PRIVATE_TELEMETRY_HOST=""
ENV NEXT_PRIVATE_TELEMETRY_HOST="$NEXT_PRIVATE_TELEMETRY_HOST"

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

USER nodejs

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/out/json/ .
# Copy the tailwind config files across
COPY --from=builder --chown=nodejs:nodejs /app/out/full/packages/tailwind-config ./packages/tailwind-config
# Copy the patches across
COPY --from=builder --chown=nodejs:nodejs /app/patches ./patches

RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Strip build-time residue that ships as production dependencies but is never
# executed at runtime.
RUN rm -rf \
    node_modules/react-email/dist/cli \
    node_modules/esbuild \
    node_modules/@esbuild \
    node_modules/.bin/esbuild \
    node_modules/.bin/email

# Automatically leverage output traces to reduce image size
# https://nodejs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nodejs:nodejs /app/apps/remix/build ./apps/remix/build
COPY --from=installer --chown=nodejs:nodejs /app/apps/remix/public ./apps/remix/public

# Copy the prisma binary, schema and migrations
COPY --from=installer --chown=nodejs:nodejs /app/packages/prisma/schema.prisma ./packages/prisma/schema.prisma
COPY --from=installer --chown=nodejs:nodejs /app/packages/prisma/migrations ./packages/prisma/migrations

# Generate the prisma client again, this time only targeting the client generator
RUN npx prisma generate --schema ./packages/prisma/schema.prisma --generator client \
    && npm cache clean --force


# Get the start script from docker/
COPY --chown=nodejs:nodejs ./docker/start.sh /app/apps/remix/start.sh

WORKDIR /app/apps/remix

CMD ["sh", "start.sh"]
