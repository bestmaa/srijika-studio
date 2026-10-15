# npm and GitHub automatic release

Srijika prepares four public packages in dependency order:

1. `@srijika/cli`
2. `@srijika/mcp-server`
3. `create-srijika`
4. `@srijika/native` (separate Native CLI, compiler, scaffold and validator)

The Native package is new in 0.7.0 and needs a first publication and its own
Trusted Publisher configuration. Until that bootstrap is complete, distribute
the verified `srijika-native-0.7.1.tgz` GitHub Release asset. Existing package
authentication does not establish access to a new npm package.

Users then create a project with:

```bash
npm create srijika@latest my-app
```

## One-time npm bootstrap

The package names must first be claimed by an npm account that owns the `srijika`
scope. Log in locally with 2FA, verify `npm whoami`, then run the release checks:

```bash
pnpm release:build
pnpm release:verify
```

Configure **Trusted Publisher → GitHub Actions** on each npm package's
settings pages:

- GitHub organization/user: `bestmaa`
- Repository: `srijika-studio`
- Workflow filename: `release-npm.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

Trusted Publishing uses GitHub OIDC and does not need a long-lived npm token.
The publish job grants `id-token: write`, runs on a GitHub-hosted Node 24 runner,
and publishes with short-lived OIDC credentials. This public source repository
publishes with provenance. No write-capable `NPM_TOKEN` is required for configured
packages; first-publish authentication for a new package remains a separate step.

## Release a version

Prepare and commit the coordinated version:

```bash
pnpm release:version 0.7.1
pnpm install --lockfile-only
pnpm release:build
pnpm release:verify
```

Merge that change, create tag `v0.7.1`, and publish a GitHub Release from the tag.
The workflow verifies the tag against all four package versions, runs the complete
quality gate, builds exact tarballs, skips versions already present after a partial
retry, and publishes with npm Trusted Publishing. Public packages built from this
private repository are published without provenance because npm does not support
private-repository provenance.

The workflow can also be run manually with **Publish** disabled. That is a safe
release dry run and never writes to npm.
