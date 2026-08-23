# VS Code Marketplace release

Srijika Language Support is published as
`srijika.srijika-language-support`. A Marketplace version is immutable: every
upload must use a new semantic version.

## Prepare one coordinated release

From the repository root:

```bash
pnpm release:version 0.4.1
pnpm install --lockfile-only
pnpm verify:fast
pnpm --filter srijika-language-support typecheck
pnpm --filter srijika-language-support test
pnpm --filter srijika-language-support build
pnpm --filter @srijika/portal build
RELEASE_TAG=v0.4.1 pnpm release:verify
```

`release:version` keeps the CLI, MCP server, create launcher, VS Code extension,
generated workspace MCP configuration, plugin references, and public website on
the same release number.

## Package and smoke-test the VSIX

```bash
cd apps/vscode-srijika
pnpm dlx @vscode/vsce@3.9.2 package --no-dependencies \
  --out ../../release-bundles/srijika-language-support-0.4.1.vsix

code --install-extension \
  ../../release-bundles/srijika-language-support-0.4.1.vsix --force
code --list-extensions --show-versions
```

Confirm that the installed list contains
`srijika.srijika-language-support@0.4.1`. The `release-bundles` directory and
VSIX files are intentionally ignored by Git; attach the verified artifact to
the matching GitHub Release instead.

## Publish

Publish the verified VSIX from the Visual Studio Marketplace publisher portal,
or use `@vscode/vsce` with a securely supplied publisher token:

```bash
pnpm dlx @vscode/vsce@3.9.2 publish \
  --packagePath ../../release-bundles/srijika-language-support-0.4.1.vsix
```

Never add a Marketplace token to the repository, command history, release
artifact, or documentation. Keep it in the publisher portal or an encrypted CI
secret.

After Marketplace verification, push the reviewed release commit and tag, then
publish the matching GitHub Release. The GitHub release event runs the guarded
npm publication workflow for the three public packages. Finally verify the
Marketplace version, npm versions, GitHub Release assets, and deployed
`srijika.com` pages independently; a successful Git push does not by itself
prove that external deployment completed.
