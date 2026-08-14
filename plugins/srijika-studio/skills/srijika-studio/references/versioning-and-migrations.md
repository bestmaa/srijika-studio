# Versioning and migrations

## Contents

- Independent versions
- Compatibility policy
- Change procedure
- Deprecation procedure

## Independent versions

Track these independently:

- Plugin version: installation package and skill release
- Tool version: MCP tool surface implementation
- Protocol version: Studio bridge request/response contract
- Document format version: canonical UI AST
- Component manifest version: individual registered component contract

Do not bump the document format because a tool description changed. Do not silently reinterpret an existing operation payload.

## Compatibility policy

- Add optional fields and new operation kinds within a compatible tool release.
- Preserve unknown optional response fields in adapters.
- Reject unknown write operation kinds instead of guessing.
- Require a protocol adapter for renamed fields or changed semantics.
- Require a document migration for persisted AST changes.
- Announce deprecated tools in capabilities with their replacement and removal target.

## Change procedure

1. Add the new schema and capability flag.
2. Add a pure adapter from the prior supported protocol payload.
3. Add contract tests for old and new payloads.
4. Update Studio bridge, MCP server, skill references, and generated schema assets together.
5. Test mixed-version rejection and migration.
6. Bump the smallest applicable version.

The initial adapter registry is intentionally transport-independent so future Studio schema changes do not require rewriting MCP stdio framing or local authentication.

## Deprecation procedure

Keep an alias only when it maps without semantic loss. Capabilities must mark it deprecated. Skill instructions must use the canonical name. Remove the alias only in a declared breaking protocol/tool release.

The initial `srijika_import_design_image` wording is a compatibility alias for `srijika_import_design_plan`; the canonical tool makes clear that Codex performs visual analysis and sends a structured plan.
