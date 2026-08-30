# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.13.0-bookworm-slim@sha256:f5a0871ab03b035c58bdb3007c3d177b001c2145c18e81817b71624dcf7d8bff

FROM ${NODE_IMAGE} AS build
ARG COREPACK_VERSION=0.34.0
ARG PNPM_VERSION=11.18.0
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN npm install --global --ignore-scripts corepack@${COREPACK_VERSION} \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/payload-next-reference ./apps/payload-next-reference

RUN pnpm install --frozen-lockfile --filter @srijika/payload-next-reference...
RUN pnpm --filter @srijika/payload-next-reference typecheck \
  && pnpm --filter @srijika/payload-next-reference test \
  && pnpm --filter @srijika/payload-next-reference build
RUN pnpm --filter @srijika/payload-next-reference deploy --prod --legacy /opt/runtime \
  && rm -rf /opt/runtime/.next /opt/runtime/test /opt/runtime/test-results \
    /opt/runtime/playwright.config.ts /opt/runtime/vitest.config.ts \
    /opt/runtime/tsconfig.tsbuildinfo /opt/runtime/.env.example \
  && cp -R /workspace/apps/payload-next-reference/.next /opt/runtime/.next \
  && find /opt/runtime/.next/node_modules -type l -exec sh -c \
    'for link do target="$(readlink "$link")"; case "$target" in ../../../../node_modules/*) target="../../${target#../../../../}" ;; *) exit 1 ;; esac; ln -snf "$target" "$link"; done' \
    sh {} +

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /opt/runtime

COPY --from=build --chown=node:node /opt/runtime ./
COPY --from=build --chown=node:node /workspace/tsconfig.base.json /tsconfig.base.json

RUN mkdir -p media .next/cache && chown -R node:node media .next/cache

USER node
EXPOSE 3000
ENTRYPOINT ["node", "deploy/container-runtime.mjs"]
CMD ["serve"]
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD ["node", "deploy/container-runtime.mjs", "healthcheck"]
