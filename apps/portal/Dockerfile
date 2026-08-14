FROM node:22.22.1-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /workspace

COPY apps/portal/package.json apps/portal/pnpm-lock.yaml apps/portal/pnpm-workspace.yaml apps/portal/

RUN cd apps/portal && pnpm install --frozen-lockfile

COPY docs docs
COPY apps/studio/src-tauri/icons/icon.png apps/studio/src-tauri/icons/icon.png
COPY apps/portal apps/portal
RUN cd apps/portal && pnpm build

FROM nginx:1.29.5-alpine AS runtime
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/portal/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
