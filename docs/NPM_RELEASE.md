# npm and GitHub automatic release

Srijika prepares four public packages in dependency order:

1. `@srijika/cli`
2. `@srijika/mcp-server`
3. `create-srijika`
4. `@srijika/native` (separate Native CLI, compiler, scaffold and validator)

All four packages are published on npm. Each package has its own Trusted
Publisher configuration; existing package authentication does not establish
access to a newly added package.

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

## Validate a new Native Trusted Publisher

A new connection must complete its first successful CI publication within two
days to bind the repository identity. Saving the connection alone does not
validate it. See the [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).

The **Release npm packages** workflow supports an isolated Native preview:

```bash
gh workflow run release-npm.yml --ref main \
  -f publish=true -f native_preview=true
```

This mode runs the normal release checks, then stamps a unique next-patch
`preview.<run-number>.<attempt>` version inside the disposable CI checkout.
It rebuilds and verifies the coordinated artifacts, and publishes only
`@srijika/native` with provenance under the `native-preview` npm tag. The other
packages, Marketplace version and `latest` tags retain their stable releases.
The source checkout's committed versions stay unchanged. Preview publishing
requires a manual run from `main` in this repository and the `npm-release`
environment.

Afterward, verify the preview's npm provenance and the connection's validated
status. Confirm that `npm view @srijika/native dist-tags --json` still shows the
stable version under `latest`. Normal GitHub Releases continue publishing all
four coordinated packages through the same `release-npm.yml` connection.

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
retry, and publishes with npm Trusted Publishing and provenance from this public
repository.

The workflow can also be run manually with **Publish** disabled. That is a safe
release dry run and never writes to npm.
