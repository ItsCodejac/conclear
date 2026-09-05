# Recovery recorder prototype

This is a developer experiment in `tools/recovery/`, not an installed ConClear feature. It tests automatic observation while a standalone process is running. It does not start at login, restart itself, integrate with agent hooks, or link snapshots to conversations. Use disposable local projects for now.

## Run and inspect

From a source checkout with Node.js 22 or later:

```bash
# PROJECT must exist; STORE's parent must exist. Use separate directories.
node tools/recovery/cli.mjs watch /tmp/example-project /tmp/example-recovery

# In another terminal: inspect status and select a snapshot's ID.
cat /tmp/example-recovery/status.json
ls /tmp/example-recovery/snapshots

# Restore into a NEW directory outside both the project and recovery store.
node tools/recovery/cli.mjs restore /tmp/example-recovery SNAPSHOT_ID /tmp/example-restored
```

The watch command stays in the foreground. Stop it with Ctrl-C. Nothing is automatically installed or enabled. The normal ConClear CLI, web UI, and MCP server do not start this recorder.

## What the experiment preserves

An initial scan records regular files, including uncommitted files. Recursive filesystem notifications request further scans; a one-second reconciliation timer also requests scans even without notifications. Scans are serialized and notification requests coalesced to avoid an unbounded queue. Each scan reads current file contents, reuses SHA-256-addressed objects, and writes a manifest when the observed tree changes. A restart creates a fresh baseline in the same project-bound store.

Objects and manifests use temporary files, file sync, rename, and directory sync. An unpublished temporary manifest is not a recovery point. Restore checks object hashes, rejects unsafe paths, and requires a new destination. Renames and deletions appear as different path inventories; earlier bytes remain in older recovery points. The prototype preserves file bytes and basic permission bits, not empty directories, ownership, timestamps, extended attributes, or symlink targets.

No AI, Git commits, or conversation parsing participates in capture. No commands recovered from messages are executed.

## Coverage and limits

**There is no promise to capture every intermediate version or prevent all code loss.** Multiple writes can occur before a scan reads a file. Notifications are hints, not a write journal. Reconciliation captures current contents but cannot recover overwritten contents it never observed. Snapshots are not atomic across files and are not certified working project states.

The status file reports the last successful scan, last snapshot, watcher state, detected errors, exclusions, and scan measurements. Restart records an interruption window; it cannot enumerate everything lost during downtime. A stale status file is not evidence that its process is still running. There is no independent health supervisor yet. Detected gaps do not represent all possible missed writes.

The prototype skips `.git`, `node_modules`, `dist`, `.DS_Store`, symlinks, special files, and files larger than 16 MiB. It reports these omissions. It does not apply `.gitignore`, redact secrets, encrypt snapshots, limit total storage, or prune history. Included configuration files are copied as bytes, so use disposable fixtures. Repeated scans read the whole included tree; this is not yet a large-project performance design.

Only one writer on one host may use a store. Dead-process locks can be reclaimed at startup; an ambiguous/live PID fails closed. A crash during lock acquisition can leave `acquiring-writer`, requiring manual inspection before removal. This is not a distributed lock. Concurrent hostile filesystem changes and power-loss durability have not been validated. Remote machines need their own coverage; the prototype does not observe remote writes.

Filesystem notification behavior varies by platform and filesystem; see the [Node.js filesystem watch caveats](https://nodejs.org/api/fs.html#caveats). If watch setup fails, periodic scanning continues and status reports the limitation.

## Validation and first measurements

```bash
npm test -- tests/recovery
node tools/recovery/measure.mjs
```

The recovery suite covers byte-for-byte restoration after shell writes, binary contents, renames and deletions; real watcher notifications; reconciliation with notifications disabled; SIGKILL and restart; scan failure; exclusions; and refusal of overwrite, path traversal, concurrent writers, and corrupt objects. It uses temporary projects and stores. A sandbox that disallows filesystem watching cannot pass the real-notification test; do not interpret that as verified notification support.

A controlled loss test disables notifications and completes 100 overwrites between scans. It preserves the baseline and final version only: the other 99 burst versions are absent. This demonstrates a limitation, not a measured real-world watcher miss rate. The crash test kills a running recorder after a completed baseline and introduces an unfinished temporary manifest; it does not exhaustively inject crashes into every storage operation.

One local synthetic run on 2026-09-05 used 100 files totaling 409,890 bytes:

| Observation | Result |
|-------------|--------|
| Initial capture | Approximately 822 ms |
| Unchanged scan | Approximately 18 ms; zero new object bytes |
| One file replaced with seven bytes | Approximately 32 ms; seven new object bytes |
| Stored objects across both recovery points | 409,897 bytes |
| Two manifests | Approximately 23.6 KB |
| Original files restored and compared | 100 of 100 matched |

These are single-run, small-fixture elapsed times, not throughput guarantees or CPU benchmarks. Initial object sync cost and full-tree rereading need measurement on representative projects before selecting production scan intervals.

## Next decision

The experiment establishes basic preservation and recovery while making the observation gap reproducible. Before offering automatic protection, extend crash injection, measure representative workloads and active-write capture rates, settle storage scope and retention, then implement operating-system service lifecycle and independent health reporting. Evaluate optional pre-operation hooks against measured gaps. Conversation linking follows a reliable recorder; stronger per-write guarantees require a different capture mechanism.
