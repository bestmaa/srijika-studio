# Payload production Compose reference

The maintained Compose stack in
[`apps/payload-next-reference`](../apps/payload-next-reference) is a portable,
single-host production reference for Next.js, Payload CMS, and PostgreSQL. It is
provider-neutral: place a TLS reverse proxy or load balancer in front of the web
service and adapt backup, observability, and secret delivery to the target host.

Srijika is development tooling in this architecture. It governs frontend owner
boundaries, validates the project, and contributes build evidence. The deployed
runtime is the Next.js/Payload application plus its production dependencies;
Studio, Desktop, CLI, and MCP packages are not copied into the image.

## Prepare secrets

From `apps/payload-next-reference`, create local secret files that are excluded
from Git:

```sh
mkdir -p deploy/secrets
openssl rand -hex 32 > deploy/secrets/postgres_password.txt
openssl rand -hex 32 > deploy/secrets/payload_secret.txt
chmod 600 deploy/secrets/*.txt
```

For a managed host, set `POSTGRES_PASSWORD_FILE` and `PAYLOAD_SECRET_FILE` to
absolute paths supplied by its secret store. Do not put secret values in the
Compose environment, image, source, or `.env` file. The entrypoint rejects
missing, short, placeholder, non-regular, or oversized secret files.
The container entrypoint reads the mounted files before immediately dropping to
the unprivileged `node` user; the application and migrations never run as root.

## Validate and start

Run from `apps/payload-next-reference`:

```sh
docker compose config
docker compose build web
docker compose up --detach --wait web
docker compose ps --all
```

The build uses pinned Node, pnpm, Next.js, Payload, and PostgreSQL inputs. A
frozen dependency install, typecheck, unit tests, and production build must all
pass before an image is emitted.

Startup is ordered and fail-closed:

1. PostgreSQL accepts connections and reports healthy.
2. The one-shot migration service applies committed migrations and exits zero.
3. The web service starts only after the migration succeeds.
4. `/api/health` queries Payload through PostgreSQL; container readiness fails
   when the application cannot reach its database.

The default published endpoint is `127.0.0.1:3000`, suitable for a reverse proxy
on the same host. Set `PAYLOAD_WEB_BIND` and `PAYLOAD_WEB_PORT` only when the host
network design requires different values.

## Persistent data

PostgreSQL data and uploads use separate named volumes, `postgres-data` and
`media`. The web container is read-only apart from the media and Next cache
mounts. Recreating the web container therefore retains uploaded files.

Back up both PostgreSQL and the media volume as one recovery point. Restoring
only one can leave records and files inconsistent. For multi-host or autoscaled
deployments, replace the local media volume with a reviewed Payload object
storage adapter and include that store in the same recovery policy.

The smoke test writes an upload probe, recreates the web container, and reads it
back:

```sh
SRIJIKA_RUN_COMPOSE_SMOKE=1 pnpm test:compose
```

It also builds from the clean Docker context, waits for the database-backed
healthcheck, verifies migration completion, and confirms that Srijika/Desktop
tooling is absent from the production image.

## Upgrade, rollback, and stop

Create and review migration files before deployment, then test them against a
restored production backup. Deploy an immutable image revision. Payload database
migrations are not assumed to be reversible: roll back application code only
when the previous revision is schema-compatible, otherwise restore the matched
database and media recovery point.

Inspect failures with `docker compose logs postgres migrate web`. Stop services
without deleting data using `docker compose down`. The `--volumes` flag destroys
the local database and media volumes and is only appropriate for disposable test
stacks.
