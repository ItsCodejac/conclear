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

An initial scan records regular files, including uncommitted files. Recursive filesystem notifications identify paths to refresh. Changed-file batches read those files or directory subtrees and retain the rest of the last successful inventory. Notifications arriving during a batch remain in a pending set for the next batch. A one-second reconciliation timer requests a full scan even without notifications; missing or unsafe notification paths also request full scans. The pending set is capped at 10,000 paths, falling back to reconciliation on overflow. Scans and batches are serialized. Each reuses SHA-256-addressed objects and writes a complete manifest when the observed inventory changes. A restart creates a fresh baseline in the same project-bound store.

Manifests identify their observation scope as `changed-paths` or `full-tree`. A changed-path recovery point combines newly observed files with previously observed inventory; it does not certify the current contents of unchanged paths. Status distinguishes `lastFullScan` from `lastSuccessfulScan`, which also advances after successful changed-path batches. Full reconciliation remains necessary for missing notifications and out-of-date inventory. A full scan can still delay changed-file capture while it runs.

Objects and manifests use temporary files, file sync, rename, and directory sync. An unpublished temporary manifest is not a recovery point. Restore checks object hashes, rejects unsafe paths, and requires a new destination. Renames and deletions appear as different path inventories; earlier bytes remain in older recovery points. The prototype preserves file bytes and basic permission bits, not empty directories, ownership, timestamps, extended attributes, or symlink targets.

No AI, Git commits, or conversation parsing participates in capture. No commands recovered from messages are executed.

## Coverage and limits

**There is no promise to capture every intermediate version or prevent all code loss.** Multiple writes can occur before a scan reads a file. Notifications are hints, not a write journal. Reconciliation captures current contents but cannot recover overwritten contents it never observed. Snapshots are not atomic across files and are not certified working project states.

The status file reports the last successful scan, last snapshot, watcher state, detected errors, exclusions, and scan measurements. Successful scans clear the current error but retain a cumulative failed-scan count and the last ten failures, including across restart when status was persisted. Restart records an interruption window; it cannot enumerate everything lost during downtime. A stale status file is not evidence that its process is still running. There is no independent health supervisor yet. Detected gaps do not represent all possible missed writes; a process killed before persisting status can lose the latest health update.

The prototype skips `.git`, `node_modules`, `dist`, `.DS_Store`, symlinks, special files, and files larger than 16 MiB. It reports these omissions. It does not apply `.gitignore`, redact secrets, encrypt snapshots, limit total storage, or prune history. Included configuration files are copied as bytes, so use disposable fixtures. Full reconciliation still reads the whole included tree, and every manifest still lists the full inventory; large-project costs remain under investigation.

Only one writer on one host may use a store. Dead-process locks can be reclaimed at startup; an ambiguous/live PID fails closed. A crash during lock acquisition can leave `acquiring-writer`, requiring manual inspection before removal. This is not a distributed lock. Concurrent hostile filesystem changes and power-loss durability have not been validated. Remote machines need their own coverage; the prototype does not observe remote writes.

Filesystem notification behavior varies by platform and filesystem; see the [Node.js filesystem watch caveats](https://nodejs.org/api/fs.html#caveats). If watch setup fails, periodic scanning continues and status reports the limitation.

## Validation and first measurements

```bash
npm test -- tests/recovery
node tools/recovery/measure.mjs
```

The recovery suite covers byte-for-byte restoration after shell writes, binary contents, renames and deletions; real watcher notifications; reconciliation with notifications disabled; SIGKILL and restart; scan failure; exclusions; and refusal of overwrite, path traversal, concurrent writers, and corrupt objects. It uses temporary projects and stores. A sandbox that disallows filesystem watching cannot pass the real-notification test; do not interpret that as verified notification support.

A controlled loss test disables notifications and completes 100 overwrites between scans. It preserves the baseline and final version only: the other 99 burst versions are absent. This demonstrates a limitation, not a measured real-world watcher miss rate.

Twenty crash cases pause a child recorder at object and manifest storage boundaries: temporary file opened, contents written, file synced, renamed into place, and directory synced, for both full-tree and changed-path capture. Each case sends SIGKILL, restores every published manifest before restart, then checks both old and current recovery after restart. All twenty passed locally. This verifies process-crash behavior at those boundaries, not arbitrary mid-system-call interruption, lock-acquisition crashes, hardware failure, or power-loss durability. A test-only constructor callback supplies the pause points; normal CLI operation has no fault-injection switch.

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

## Larger workload results

Run the disposable stress harness separately from other benchmarks:

```bash
node tools/recovery/stress.mjs 1000 16384 > /tmp/conclear-stress-1000.json
node tools/recovery/stress.mjs 5000 16384 > /tmp/conclear-stress-5000.json
```

Each fixture starts with uniquely hashed 16 KiB files. Two child processes then write separate files concurrently: one rewrites in place, the other writes a temporary file and renames it. The paced phase completes 80 writes per writer, waiting 20 ms after each write; the burst phase completes 200 per writer without a deliberate delay. A version counts as captured only if a published manifest references its exact bytes at its intended path. Unreferenced objects and temporary filenames do not count. The harness waits for both final versions to be observed automatically, then performs bulk shell renames/deletions and explicitly captures the settled result for restoration checks.

These are aggressive synthetic workloads, not representative typing rates. Single local runs on 2026-09-05 used Node v26.4.0 on Darwin 24.6.0. Raw reports, with temporary paths replaced, are in `tools/recovery/results/`. The following table records the original full-scan-per-notification implementation, before changed-path capture.

| Measurement | 1,000 files / 16.4 MB | 5,000 files / 81.9 MB |
|-------------|-----------------------|-----------------------|
| Initial baseline elapsed | 8.8 s | 43.4 s |
| Paced versions captured | 14 / 160 | 2 / 160 |
| Burst versions captured | 2 / 400 | 2 / 400 |
| Paced captured-version delay, p95 | 214 ms | 183 ms |
| Burst captured-version delay, p95 | 250 ms | 1,515 ms |
| Paced scan duration, p95 | 468 ms | 1,772 ms |
| Paced phase CPU time, user + system | 1.41 s | 1.00 s |
| Burst phase CPU time, user + system | 0.21 s | 1.65 s |
| Peak sampled process RSS | 99.3 MB | 209.5 MB |
| Final object storage | 16.66 MB | 81.99 MB |
| Final manifest storage | 1.49 MB / 12 manifests | 2.47 MB / 4 manifests |
| Original files restored exactly | 1,000 / 1,000 | 5,000 / 5,000 |
| Settled final files restored exactly | 904 / 904 | 4,904 / 4,904 |

CPU includes recorder and harness work but excludes writer child processes. RSS also includes the harness and uses 25 ms sampling. Capture delay only describes versions that survived; a low delay does not imply good coverage. Metrics and manifest counts depend on scheduling and should not be treated as stable performance guarantees. The 1,000-file run preceded the failure-history addition; the 5,000-file run included it.

Concurrent modifications caused scan failures rather than publication of those failed scans. The 5,000-file bulk rename/delete phase produced ten failed scans; all ten remained in persisted status after successful recovery. Original and final recovery matched in both workloads, while most intermediate versions were missed. Full manifests also grow in proportion to project size even when only a few files change.

## Next decision

The changed-path implementation has now been compared with the same harness. Single reruns produced the following results; raw reports have the suffix `-changed-paths.json`:

| Measurement | 1,000 files: before → after | 5,000 files: before → after |
|-------------|----------------------------|----------------------------|
| Paced versions captured, out of 160 | 14 → 65 | 2 → 20 |
| Burst versions captured, out of 400 | 2 → 2 | 2 → 2 |
| Paced captured-version delay, p95 | 214 → 46 ms | 183 → 1,370 ms |
| Paced phase CPU time, user + system | 1.41 → 0.47 s | 1.00 → 1.63 s |
| Final manifest storage | 1.49 → 7.09 MB | 2.47 → 8.06 MB |

All original and settled final files again restored exactly in both sizes. Coverage improved in the paced workload, but the rapid burst still lost all intermediate versions. Captured-version delay and CPU did not improve uniformly: full reconciliation still blocks the serialized capture queue, particularly in the larger project. More preserved versions also produce more full manifests. These comparisons are single runs with scheduling variability, not stable speedup factors.

Before installing a background service, investigate how to let changed-file capture progress during reconciliation without publishing stale inventories, and reduce manifest growth without weakening independent recovery or crash behavior. Baseline sync cost also remains. Repeat the same workload and crash tests after each change, then choose storage limits, retention, and scan intervals from the evidence.

Automatic service lifecycle and independent health reporting follow those checks. Optional pre-operation hooks may preserve useful pre-command states but still cannot guarantee every internal write. Conversation linking follows a reliable recorder; stronger per-write guarantees require a different capture mechanism. The prototype remains developer-only.
