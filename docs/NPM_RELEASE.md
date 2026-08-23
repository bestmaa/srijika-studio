# npm and GitHub automatic release

Srijika publishes three public packages in dependency order:

1. `@srijika/cli`
2. `@srijika/mcp-server`
3. `create-srijika`

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

Configure **Trusted Publisher → GitHub Actions** on each of the three npm package
settings pages:

- GitHub organization/user: `bestmaa`
- Repository: `srijika-studio`
- Workflow filename: `release-npm.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

Trusted Publishing uses GitHub OIDC and does not need a long-lived npm token.
The publish job grants `id-token: write`, runs on a GitHub-hosted Node 24 runner,
and publishes with short-lived OIDC credentials. npm does not generate provenance
for a private source repository, so the publish command must not force the
`--provenance` flag. No write-capable `NPM_TOKEN` is required.

## Release a version

Prepare and commit the coordinated version:

```bash
pnpm release:version 0.4.0
pnpm install --lockfile-only
pnpm release:build
pnpm release:verify
```

Merge that change, create tag `v0.4.0`, and publish a GitHub Release from the tag.
The workflow verifies the tag against all three package versions, runs the complete
quality gate, builds exact tarballs, skips versions already present after a partial
retry, and publishes with npm Trusted Publishing. Public packages built from this
private repository are published without provenance because npm does not support
private-repository provenance.

The workflow can also be run manually with **Publish** disabled. That is a safe
release dry run and never writes to npm.
