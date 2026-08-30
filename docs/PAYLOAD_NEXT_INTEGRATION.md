# Payload CMS + Next.js integration

Srijika governs frontend ownership and presentation architecture in a Payload
project. It does not replace Payload CMS, its Admin UI, access-control engine,
database adapter, migrations, upload storage, or API routes.

The `srijika-payload-next-v1` profile is enabled only when `payload` and
`@payloadcms/next` are both declared. Detection is source-only: Srijika never
executes `payload.config.ts`, loads a collection, or connects to a database while
planning adoption or migration.

## Ownership boundaries

| Surface                                   | Owner                     | Srijika behavior                                                          |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `payload.config.ts`, collections, globals | Payload server            | Preserve in place; never propose as UI, Connector, Hook, or client Store  |
| `(payload)/admin`, REST, GraphQL routes   | Payload + Next.js         | Preserve as framework-owned routes; Admin stays outside Srijika ownership |
| Local API loaders and database imports    | Server Component or route | Keep server-only and pass serializable data into UI                       |
| `payload-types.ts` and import maps        | Payload contract          | Protect from migration; allow type-only imports into UI                   |
| Migrations and upload/storage modules     | Deployment server         | Preserve paths and deployment behavior                                    |
| `.ui.tsx`                                 | Srijika presentation      | Render serializable props with no Payload or database runtime import      |
| Client Connector/API                      | Srijika client boundary   | Mutate through authenticated REST or GraphQL requests                     |

`SRIJIKA5006` reports a direct Payload Local API or database runtime import in a
`.ui.tsx` file or client Next.js boundary. The diagnostic explains both valid
paths: load on the server and pass serializable props, or use an authenticated
REST/GraphQL Connector for browser mutations. Type-only imports from
`payload-types.ts` remain valid.

## Maintained reference

[`apps/payload-next-reference`](../apps/payload-next-reference) pins Payload
`3.88.0` and Next.js `16.3.3`. It contains:

- authenticated users, published-or-authenticated post access, drafts, and a
  global setting;
- image uploads with a derived card size;
- checked-in types and a PostgreSQL index migration;
- Payload Admin, REST, GraphQL, and GraphQL Playground route handlers;
- server-side list and detail loaders that serialize data before rendering pure
  UI owners;
- a client Connector with authenticated REST create/update and a GraphQL
  mutation example;
- owner tests, a production Next.js build, and a Chromium list/detail test that
  run without a production database.

Run the reference from the workspace root:

```sh
pnpm --filter @srijika/payload-next-reference typecheck
pnpm --filter @srijika/payload-next-reference test
pnpm --filter @srijika/payload-next-reference build
pnpm --filter @srijika/payload-next-reference test:browser
```

The build and browser harness set `PAYLOAD_REFERENCE_MODE=mock`. Normal runtime
requests use Payload Local API with the request headers and `overrideAccess:
false`; this keeps collection access rules authoritative without requiring the
test suite to start PostgreSQL.

For an immutable production image, secret-file injection, deterministic
migrations, database-backed readiness, upload persistence, and backup guidance,
follow the [Payload production Compose reference](./PAYLOAD_COMPOSE_DEPLOYMENT.md).

## Authentication and access control

Server loaders must pass the incoming request context to Payload and keep
`overrideAccess: false`. Client mutation requests use `credentials: 'include'`
for Payload's auth cookie and may add a session JWT in the `Authorization`
header. Obtain that credential through the application's authenticated session;
never place a fixed token in source.

Collection access remains the final authority. A hidden button or route is not
an access-control rule. The reference permits public reads only for published
posts and requires an authenticated user for create, update, and delete.

## Drafts and preview

Published pages query with `draft: false` and `_status: published`. A preview
route should authenticate the editor, call Local API with `draft: true`, and
pass the draft as serializable props into the same UI owner. Payload Admin live
preview remains Payload-owned unless a separate reviewed adapter is introduced.

## Media and environment

Treat media URLs as server data. Serialize only the public URL and metadata a UI
owner needs; do not import an upload adapter in client code.

Required production environment:

- `DATABASE_URL`: PostgreSQL connection string.
- `PAYLOAD_SECRET`: a long, private signing secret; do not use the local fallback.
- public site and storage variables required by the selected deployment and
  upload adapter.

`PAYLOAD_REFERENCE_MODE=mock` is for deterministic build/browser evidence only.
Do not set it in production.

## PostgreSQL deployment

Create reviewed schema changes with `pnpm payload:migration`, commit the migration
files, and run `pnpm payload:migrate` against the target database before serving
the new application revision. Build the same immutable revision with `pnpm
build`. Do not run development push mode against a production database.
