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

For the first release only, either publish the three package directories manually
in the order above or add a short-lived granular npm automation token as the
repository secret `NPM_TOKEN`. Remove that secret after the bootstrap succeeds.

For each package on npmjs.com, configure **Trusted Publisher → GitHub Actions**:

- GitHub organization/user: `bestmaa`
- Repository: `srijika-studio`
- Workflow filename: `release-npm.yml`
- Environment: `npm-release`
- Allowed action: `npm publish`

Trusted Publishing uses GitHub OIDC and does not need a long-lived npm token. The
workflow grants only `contents: read` and `id-token: write` to the publish job.

## Release a version

Prepare and commit the coordinated version:

```bash
pnpm release:version 0.2.0
pnpm install --lockfile-only
pnpm release:build
pnpm release:verify
```

Merge that change, create tag `v0.2.0`, and publish a GitHub Release from the tag.
The workflow verifies the tag against all three package versions, runs the complete
quality gate, builds exact tarballs, skips versions already present after a partial
retry, and publishes with npm provenance.

The workflow can also be run manually with **Publish** disabled. That is a safe
release dry run and never writes to npm.
