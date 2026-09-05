# Development and releases

## Keep documentation with the change

Update documentation in the same change as the behavior it describes:

| Change | Documentation to update |
|--------|-------------------------|
| CLI options or JSON output | `docs/src/cli-commands.md`, `docs/src/cli-examples.md`, CLI help, and bundled `skill.md` |
| MCP inputs, output, or retrieval behavior | `docs/src/mcp-server.md`, `skill.md`, and README examples |
| Adapter behavior or capabilities | `docs/src/adapter-pattern.md`, the relevant tool page, and capability tables |
| Architecture or implementation boundaries | `docs/src/architecture.md` |
| User-facing changes and migration steps | `CHANGELOG.md` under **Unreleased**, README, and the relevant reference page |

Add new documentation pages to `docs/src/SUMMARY.md`. It determines both the documentation navigation and the pages included in `llms.txt`. Edit the source pages, then regenerate the combined document:

```bash
npm run docs:generate
npm run docs:check
```

Include the generated `llms.txt` in the same change. CI and the npm prepublish hook check that it matches its sources; the generator also fails if a referenced page cannot be read. This checks synchronization, not factual accuracy: review examples and capability claims against the implementation.

## Pending retrieval migration

The unreleased retrieval update changes CLI JSON and MCP response shapes:

| Surface | Previous response | New response |
|---------|-------------------|--------------|
| CLI `search --json`, MCP `conclear_search` | Match array | `{ matches, coverage }` |
| CLI `context --json`, MCP `conclear_context` | Message array | `{ sessionId, tool, revision, scope, messages, page }` |

Change scripts such as `jq '.[] | .text'` on search output to `jq '.matches[] | .text'`. Context consumers should read `.messages` and retain `.page` to assess completeness and continue retrieval. A default context request returns up to the last 20 messages within a shared 12,000-character text budget; JSON metadata is additional. It no longer requests the whole conversation by default.

The existing web `/api/search` array and `/api/sessions/:id/conversation` preview responses keep their shapes. The new bounded endpoint is `/api/sessions/:id/context`. See [MCP Server](mcp-server.md#conclear_context) for cursor rules, character offsets, omitted-history metadata, and reference validity.

After installing the release, restart the ConClear web process and reconnect or restart MCP clients so they discover the updated tool schemas. For clients using the bundled skill, re-run `conclear install` for the desired clients to refresh their installed copy. Package upgrades alone do not rewrite previously copied skills.

Automatic later-evidence discovery, active-conversation checkpoints, and project-belief maintenance are not part of this release. Retrieval provides original evidence and coverage information; timestamps and later messages do not certify correctness.

## Before a release

Keep changes under **Unreleased** until the release version and date are chosen. Update package metadata and lockfile root versions together, move the release notes into a versioned entry, and review any breaking response changes before publishing.

Run the release checks from the project root:

```bash
npm run docs:check
npm run build
npm test
git diff --check
```

The retrieval regression suite can also run independently:

```bash
npm test -- tests/retrieval
```

It covers message-reference validity, bounded continuation, all five conversation formats, CLI/MCP/REST behavior, and retrieval size on a synthetic claim-and-correction history. The size check measures serialized characters, not model token use or answer quality. Avoid documenting a targeted test run as a full-suite pass.
