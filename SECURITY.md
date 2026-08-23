# Security policy

## Supported versions

Security fixes are applied to the latest released Srijika CLI, MCP server, and create launcher. Development builds from the default branch are supported only until the next release replaces them.

## Reporting a vulnerability

Please use the repository's private **Security → Report a vulnerability** flow. Do not open a public issue for an unpatched vulnerability or include secrets, credentials, personal data, or a working exploit in public logs.

Include the affected package and version, the smallest safe reproduction, expected impact, and any known mitigation. Maintainers should acknowledge the report, assess severity, prepare a private fix and regression test, and coordinate disclosure after patched artifacts are available.

## Automated dependency policy

Pull requests, default-branch changes, and npm release verification run a production dependency audit. A known production advisory fails the gate; a temporary exception must be documented with scope, exposure analysis, mitigation, owner, and expiry.
