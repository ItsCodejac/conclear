# ConClear meeting demo — 2026-10-16

## The useful claim

ConClear can preserve observed, uncommitted file states independently of an agent's editing tools, then restore a selected state with verifiable bytes. Conversation retrieval supplies original evidence with explicit coverage instead of an authoritative project-memory summary. These are implemented capabilities with different levels of integration: the recorder is still a source-checkout prototype, and automatic conversation-to-snapshot linking is future work.

Suggested opening: “I lost a working implementation that an agent never committed. The conversations explained what happened, but that did not reliably preserve the exact files. ConClear now has an independent recorder and a recovery workflow. Here is a small example where the working code never enters Git history.”

## Start the live demo

Requirements: this source checkout, installed project dependencies, Node.js 22 or later, Git, a POSIX shell (`/bin/sh`, as on macOS/Linux), and local filesystem watching support.

```bash
# Preflight: creates a disposable Git fixture, runs the whole recovery flow,
# prints evidence, stops its recorder, and removes its temporary files.
npm run recovery:check

# Live browser demo: open the loopback URL printed by this command.
npm run recovery:demo
```

The server binds only to `127.0.0.1` on an available port. It does not open a browser automatically. Every write, deletion, Git operation, and restore stays in a fresh temporary fixture. Git has one starter commit; the working implementation is never committed. The four buttons operate on actual files and the actual recorder, not simulated timelines. Captures in this demo come from watching/reconciliation; the demonstration does not call a forced checkpoint after each edit.

Ctrl-C stops the recorder and removes the disposable fixture. After completing a run, **Start a new disposable run** creates a fresh fixture for another rehearsal. Source files, configuration, tests, snapshot IDs, pin reasons, Git status, and test output are inspectable in the interface. The fixture has three Node test cases; passing them is a bounded demonstration, not certification of production correctness.

## A two-minute walkthrough

1. Start with the unimplemented checkout. The starter commit exists and the fixture checks fail.
2. Click **Write & test**. A shell writes working code, the observer captures it, and all three fixture checks pass. Git still shows one commit.
3. Click **Protect working point**. The captured point receives a durable pin with a reason and declared source. A pin preserves bytes; its reason is not a verified project belief.
4. Click **Overwrite & delete**. A shell overwrites the implementation and deletes `pricing.json`. The fixture checks fail. There is still no Git commit containing the working code.
5. Click **Restore captured state**. All three files are hash-checked and copied into a new directory. The recovered fixture passes its checks. The original workspace stays broken and the recorder continues observing it.

Open the evidence panels to show the actual automatically captured point and the separate recovered directory. If the browser is inconvenient, use `npm run recovery:check` as the terminal fallback. It executes the same operations and prints their results.

## What to discuss with Anthropic

Claude Code already checkpoints its editing tools; its documented exclusions include shell-made changes and many changes outside the current session. Position independent observation as complementary coverage, with measured gaps. See [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing), checked 2026-10-16.

The [hooks reference](https://code.claude.com/docs/en/hooks) already documents `PreToolUse` and `PostToolUse`. The integration questions are about stable attribution, latency, and coverage rather than whether hooks exist:

- Which stable session/tool/message identifiers should external recovery points reference?
- What information can identify shell-side file changes without relying on the model to describe them?
- Could a checkpoint request confirm durable capture before a high-impact operation, with clear behavior when capture is unavailable?
- How should a client report incomplete coverage without adding repetitive status output to model context?
- What evidence would be most useful for evaluating recovery across concurrent sessions and external tools?

Future hooks could attach provenance or request a pre-command capture. They do not make a watcher preserve every write inside a command. The independent recorder remains useful when an agent knows nothing about it.

## Claims to keep precise

| Demonstrated | Still limited or future |
|--------------|-------------------------|
| Exact restoration of recorded file bytes | Every intermediate filesystem state is not captured |
| Shell-write and deletion recovery in the fixture | Project-wide snapshots are not atomic |
| Durable user/agent-declared pins | Pin reasons and test claims are not correctness certification |
| Restore protected against concurrent expiration | Long restores can delay maintenance; this is a single-host coordinator |
| Preservation by default; explicit expiration mode | Quotas can pause recording, leaving a visible coverage gap |
| Bounded conversation retrieval in CLI/MCP | Automatic links between captured files and real conversations are not implemented |
| Packaged CLI, Recovery page, MCP health, and managed local observer; real macOS SIGKILL restart verified | Remote observation and automatic conversation attribution remain future work |

The September large-fixture benchmarks established both improvements and substantial missed-version rates. Their exact counts are historical single runs, not a current production SLA. The current source-checkout demo is deliberately smaller and validates a specific recovery flow. Full details are in [Recovery recorder prototype](recovery-prototype.md).

## Release status

Version 0.5.0 is prepared locally with recovery runtime files in the npm archive. The installed-package macOS check exercises a temporary real launchd service, then removes that service while preserving fixture evidence. The GitHub source and npm registry publication are separate release steps; check their actual status before telling an audience to install the new version from npm.

## Presentation text

ConClear combines local conversation evidence with independent recovery of observed code. Agents can retrieve focused original messages with explicit completeness metadata, while an agent-independent background observer preserves enrolled project files even when edits happen through shell commands and no Git commit was made. Selected points can be pinned and restored into a separate directory with verified file hashes.

Recovery is integrated into the CLI, web UI, local API, and read-only MCP tools. The macOS package workflow has been exercised through service startup, capture after the CLI exits, destructive fixture edits, verified restoration, and automatic restart after the observer was killed. Preservation is the default: recording pauses visibly when its limits are reached rather than silently deleting published history. Expiration requires an explicit policy.

The boundary is precise: a watcher preserves states it observes; rapid intermediate writes can be missed, snapshots are not atomic across files, and captured bytes do not prove that a project worked. Automatic conversation-to-snapshot attribution and remote coverage are future work.
