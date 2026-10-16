# Recovery recorder prototype

This is a developer experiment in `tools/recovery/`, not an installed ConClear feature. It tests automatic observation while a standalone process is running. It does not start at login, restart itself, integrate with agent hooks, or link snapshots to conversations. Use disposable local projects for now.

## Run and inspect

From a source checkout with Node.js 22 or later:

```bash
# PROJECT must exist; STORE's parent must exist. Use separate directories.
node tools/recovery/cli.mjs watch /tmp/example-project /tmp/example-recovery

# Optional persisted policy: payload budget in bytes, retained recovery points.
node tools/recovery/cli.mjs watch /tmp/example-project /tmp/example-recovery --max-bytes 536870912 --keep 200

# In another terminal: inspect status and select a snapshot's ID.
cat /tmp/example-recovery/status.json
ls /tmp/example-recovery/snapshots

# Restore into a NEW directory outside both the project and recovery store.
node tools/recovery/cli.mjs restore /tmp/example-recovery SNAPSHOT_ID /tmp/example-restored

# Inspect points and protect one from any future expiration policy.
node tools/recovery/cli.mjs list /tmp/example-recovery
node tools/recovery/cli.mjs pin /tmp/example-recovery SNAPSHOT_ID --reason "Reviewed working checkout" --by user
node tools/recovery/cli.mjs unpin /tmp/example-recovery SNAPSHOT_ID --reason "No longer needed"

# Expiration is a deliberate opt-in, rather than the default.
node tools/recovery/cli.mjs watch /tmp/example-project /tmp/example-recovery --retention expire --keep 200
```

The watch command stays in the foreground. Stop it with Ctrl-C. It prints state changes, including `storage-full`, as JSON events in addition to persisting status. Nothing is automatically installed or enabled. The normal ConClear CLI, web UI, and MCP server do not start this recorder. For a disposable live demonstration, use `npm run recovery:demo` or the terminal preflight `npm run recovery:check`; see [Recovery meeting demo](meeting-demo.md).

## What the experiment preserves

An initial scan records regular files, including uncommitted files. Recursive filesystem notifications identify paths to refresh. Changed-file batches read those files or directory subtrees and retain the rest of the last successful inventory. Notifications arriving during a batch remain in a pending set for the next batch. A one-second reconciliation timer requests a full scan even without notifications; missing or unsafe notification paths also request full scans. The pending set is capped at 10,000 paths, falling back to reconciliation on overflow. Inventory publication remains serialized, but a full walk can service one pending changed-path batch between file reads once at least 20 ms has elapsed. The full walk then preserves the newer observations from those batches instead of publishing its older reads for those paths. A restart rescans the same project-bound store and reuses the latest snapshot when the inventory is unchanged, avoiding duplicate recovery points.

Manifests identify their observation scope as `changed-paths` or `full-tree`. A changed-path recovery point combines newly observed files with previously observed inventory; it does not certify the current contents of unchanged paths. A full-tree point can incorporate the newer changed-path observations made during its walk. Status distinguishes `lastFullScan` from `lastSuccessfulScan`, which also advances after successful changed-path batches. Full reconciliation remains necessary for missing notifications and out-of-date inventory. The 20 ms check is not a latency guarantee: an individual file read, object sync, compression, or publication can take longer. Initial baseline capture does not yet yield to changed-path batches.

Each manifest stores its complete inventory as a gzip-compressed, base64-encoded field in the JSON envelope (`inventoryEncoding: "gzip-base64"`). It needs no previous manifest or delta chain to restore. `readSnapshot()` in the prototype expands inventories and also accepts earlier plain `entries`/`skipped` manifests. Consumers that inspect prototype manifests directly must use that reader for new snapshots. Expanded inventory is limited to 64 MiB on both write and decompression; larger new inventories fail explicitly. File objects remain uncompressed and content-addressed.

Objects and manifests use temporary files, file sync, rename, and directory sync. An unpublished temporary manifest is not a recovery point. Restore checks object hashes, rejects unsafe paths, and requires a new destination. Renames and deletions appear as different path inventories; earlier bytes remain in older recovery points. The prototype preserves file bytes and basic permission bits, not empty directories, ownership, timestamps, extended attributes, or symlink targets.

No AI, Git commits, or conversation parsing participates in capture. No commands recovered from messages are executed.

## Coverage and limits

**There is no promise to capture every intermediate version or prevent all code loss.** Multiple writes can occur before a scan reads a file. Notifications are hints, not a write journal. Reconciliation captures current contents but cannot recover overwritten contents it never observed. Snapshots are not atomic across files and are not certified working project states.

The status file reports the last successful scan, last snapshot, watcher state, detected errors, exclusions, and scan measurements. Successful scans clear the current error but retain a cumulative failed-scan count and the last ten failures, including across restart when status was persisted. Restart records an interruption window; it cannot enumerate everything lost during downtime. A stale status file is not evidence that its process is still running. There is no independent health supervisor yet. Detected gaps do not represent all possible missed writes; a process killed before persisting status can lose the latest health update.

The prototype skips `.git`, `node_modules`, `dist`, `.DS_Store`, symlinks, special files, and files larger than 16 MiB. It reports these omissions. It does not apply `.gitignore`, redact secrets, or encrypt snapshots. Included configuration files are copied as bytes, so use disposable fixtures. Full reconciliation still reads the whole included tree, and every manifest still contains the full inventory despite compression; large-project costs remain under investigation.

## Storage budget and retention

**The default is preservation:** keep all published recovery points and pause new captures when the payload or point-count limit prevents another point. New stores use experimental ceilings of 512 MiB and 200 points. These ceilings are not a recommended history lifetime, and a busy session can reach 200 points quickly. CLI state-change events and persisted status expose that pause. A full recorder cannot preserve further writes until limits are increased or an expiration policy is explicitly selected.

`--max-bytes` (at least 1,024), `--keep` (at least 2), and `--retention preserve|expire` persist in `project.json`; later starts reuse the selected policy. Older configured stores without a mode upgrade conservatively to preservation. An unbounded store without any policy requires explicit limits or mode before management starts. Reading or restoring an older store does not require policy migration.

`--retention expire` enables expiration of unprotected points, oldest first, above the count target or an 80% byte headroom target. It always protects the earliest available baseline, newest point, and user-selected pins. Enabling expiration can remove history at startup. New snapshot ordering values increase monotonically across restart, so a backward wall-clock change does not reverse retention order. If protected points alone prevent limits being satisfied, capture pauses rather than deleting them. Point-count targets can be temporarily exceeded in expiration mode until an outer scan completes or protected points are explicitly released; payload reservations still apply.

Pins are durable metadata, with a reason, declared `user` or `agent` actor, timestamps, and optional `--source REF` pointer. Pinning verifies the snapshot's recorded objects. Re-pinning updates its annotation; `unpin` requires an explicit reason. Pin metadata holds up to 1,000 active pins and the last 100 pin/unpin events. Actor/source fields are caller declarations, not authenticated authorship, a complete audit log, or correctness certification. A reason such as “tests passed” remains an assessment. Automatic maintenance never unpins a point. The capture and storage paths use no AI to decide what is correct.

The byte budget counts file objects, manifests, and temporary payload files at their logical byte sizes. New payload is reserved before writing, including temporary writes, so an oversized new capture fails instead of overrunning the budget. Metadata files, directory entries, filesystem allocation overhead, and restored copies are outside this budget. It is not a hard quota on the entire recovery directory. Lowering a limit below already-protected data does not delete that data to satisfy the limit; startup/capture fails until enough budget is supplied.

Maintenance runs between outer scans: at startup, when the count exceeds its limit, after a budget failure, or after 30 seconds. It never reclaims objects staged by an in-progress cooperative scan. Maintenance reads every published manifest, validates referenced object presence and pins, and verifies retained object hashes before deleting history. Unexpected files, malformed manifests/pins, missing references, or detected retained-object corruption stop pruning. Expired manifests are removed and the directory synced before unreferenced objects are removed, so a process crash during pruning does not deliberately strand retained references. Preservation mode still reclaims abandoned temporary files and objects that no published point references; it never expires a published recovery point.

When a new payload cannot fit, status becomes `storage-full`, retains failure details, and records a retry time. Automatic retries back off for 30 seconds; a manual capture can retry sooner. Startup exits if it cannot establish a baseline. Status includes policy, reserved payload bytes, snapshot count, and the last maintenance result; protected IDs and removed counts describe that maintenance pass. An unchanged capture may succeed without needing space for a new snapshot. Errors are not proof of every missed write, and a physically full disk can also prevent status updates.

Restoration, pin changes, listing, and cleanup share a single-host coordination gate. A restore holds it from manifest selection through copying, so expiration cannot remove the selected point midway. Recording can continue until it needs maintenance or reaches quota; a long restore can delay cleanup. The gate waits up to ten seconds for a live owner, recovers a demonstrably dead PID, and never steals ownership just because a timeout elapsed. PID reuse fails conservatively. A crash during the short `control-acquiring` guard can require manual inspection, like the existing writer-acquisition guard. Do not remove a guard while another process is acquiring it. Crash handling is not a guarantee against hardware failure, hostile store mutation, or distributed access. This prototype still installs no service.

Only one writer on one host may use a store. Dead-process locks can be reclaimed at startup; an ambiguous/live PID fails closed. A crash during lock acquisition can leave `acquiring-writer`, requiring manual inspection before removal. This is not a distributed lock. Concurrent hostile filesystem changes and power-loss durability have not been validated. Remote machines need their own coverage; the prototype does not observe remote writes.

Filesystem notification behavior varies by platform and filesystem; see the [Node.js filesystem watch caveats](https://nodejs.org/api/fs.html#caveats). If watch setup fails, periodic scanning continues and status reports the limitation.

## Validation and first measurements

```bash
npm test -- tests/recovery
node tools/recovery/measure.mjs
node tools/recovery/soak.mjs 60
# Optional longer memory diagnostic; forced GC is not normal recorder behavior.
node --expose-gc tools/recovery/soak.mjs 180
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

## Changed-path comparison

The changed-path implementation has now been compared with the same harness. Single reruns produced the following results; raw reports have the suffix `-changed-paths.json`:

| Measurement | 1,000 files: before → after | 5,000 files: before → after |
|-------------|----------------------------|----------------------------|
| Paced versions captured, out of 160 | 14 → 65 | 2 → 20 |
| Burst versions captured, out of 400 | 2 → 2 | 2 → 2 |
| Paced captured-version delay, p95 | 214 → 46 ms | 183 → 1,370 ms |
| Paced phase CPU time, user + system | 1.41 → 0.47 s | 1.00 → 1.63 s |
| Final manifest storage | 1.49 → 7.09 MB | 2.47 → 8.06 MB |

All original and settled final files again restored exactly in both sizes. Coverage improved in the paced workload, but the rapid burst still lost all intermediate versions. In that implementation, captured-version delay and CPU did not improve uniformly: full reconciliation still blocked the serialized capture queue, particularly in the larger project. More preserved versions also produced more full manifests. These comparisons are single runs with scheduling variability, not stable speedup factors.

## Cooperative reconciliation and compression comparison

The next implementation services pending changes between full-walk file reads and compresses each independent inventory. The same two workloads were rerun; reports use the suffix `-cooperative.json`.

| Measurement | 1,000 files: changed-path → cooperative | 5,000 files: changed-path → cooperative |
|-------------|----------------------------------------|----------------------------------------|
| Paced versions captured, out of 160 | 65 → 68 | 20 → 55 |
| Burst versions captured, out of 400 | 2 → 2 | 2 → 3 |
| Paced captured-version delay, p95 | 46 → 54 ms | 1,370 → 63 ms |
| Paced phase CPU time, user + system | 0.47 → 0.68 s | 1.63 → 1.14 s |
| Baseline manifest bytes | 124,339 → 57,923 | 620,339 → 287,119 |
| Total manifest storage | 7.09 → 3.87 MB | 8.06 → 12.62 MB |
| Total manifests | 57 → 67 | 13 → 44 |

Original and settled final restorations again matched exactly at both sizes. Tests also force a rewrite or deletion after an early full-walk read and verify that reconciliation preserves the newer changed-path observation. Compressed and legacy plain manifests restore, corrupt compressed inventories are rejected, and the twenty storage-boundary crash cases still pass with compression enabled.

Coverage and delay improved materially in the larger paced run. The smaller run showed little coverage difference and higher CPU time. Compression reduced baseline inventory size by approximately 54%, but the larger run's total storage increased because it retained more recovery points. Almost all burst versions remain absent. These are single-run comparisons; they do not establish a general capture percentage or a guaranteed latency. Outer full-walk durations include serviced batches, so their durations must not be summed as independent work.

## Next decision

Retention checks cover baseline/newest protection, shared objects, budget exhaustion and recovery, explicitly lowered limits, old-store migration, corrupt manifests, and clock rollback. Two additional SIGKILL cases interrupt pruning after manifest deletion has been synced and after object deletion has been synced. Every remaining point restores before restart; the protected baseline also restores after restart. These complement the twenty capture-boundary crash cases and do not substitute for power-loss tests.

Two short sustained runs on 2026-09-05 used 50 initial 1 KiB files, repeated atomic replacements, a 256 KiB payload limit, and a 12-point retention target. Both ran three graceful stop/restart cycles, restoring all retained points after each cycle and comparing restored bytes with the fixture's known writes. Raw results are in `tools/recovery/results/2026-09-05-retention-60s.json` and `2026-09-05-retention-180s.json`.

| Observation | 60-second workload | 180-second workload |
|-------------|--------------------|---------------------|
| Completed writes | 538 | 1,661 |
| Snapshot restoration checks | 36 | 36 |
| File restoration checks | 1,833 | 1,833 |
| Retained points after each cycle | 12 | 12 |
| Peak sampled payload | 121,002 bytes | 116,568 bytes |
| Final payload | 103,270 bytes | 103,280 bytes |
| Persisted capture failures | 11 | 9 |
| Peak sampled process RSS | 128.7 MB | 150.6 MB |

Repeated baselines count as separate restoration checks, not distinct snapshots. Samples can miss short-lived peaks; write reservations are the budget enforcement mechanism. In the one-minute run, RSS increased across cycles. The three-minute run used `--expose-gc` to diagnose this: live heap after each forced collection was approximately 5.5, 5.7, and 5.8 MB. That does not demonstrate an unbounded live-heap buildup in this fixture, but neither run establishes leak freedom or long-duration reliability. Forced collection is not part of ordinary recorder operation. CPU and memory measurements include the harness and its writer, and capture failures remain visible even after later success.

The September retention runs above exercised expiration; the harness now opts into that mode explicitly. They predate the October preservation-default, pinning, and coordination changes and are historical measurements, not a fresh sustained test of those changes.

Preservation defaults, durable pins, and coordinated restoration are now implemented. October regressions cover point-limit pauses without history deletion, unchanged restarts, pins through expiry/restart, explicit unpinning, pin-metadata corruption, CLI operations, and a restore in a separate process while expiration waits. A disposable live demo additionally recovers a shell-written implementation and deleted configuration file with only a starter Git commit, verifying all three restored files and their fixture tests while recording remains active.

A fresh 60-second run on 2026-10-16 exercised the coordinated cleanup/restore path with explicit expiration: 576 writes, three restart cycles, 36 retained-snapshot restoration checks, and 1,833 file checks all completed. Peak sampled payload was 112,148 bytes against a 262,144-byte budget; one capture failure remained visible. The raw report is `tools/recovery/results/2026-10-16-coordinated-60s.json`. This small fixture does not establish a long-duration memory or reliability guarantee and does not measure general capture coverage.

Before a real-project trial, broaden sustained-operation testing beyond the short fixture, including physical storage failures and long restores. Set an explicit coverage/exclusion policy for the chosen project. Baseline sync cost, acquisition-guard recovery, and missed intermediate writes remain. Preserve the independent recovery and crash checks while addressing those limits; do not turn these measurements into a promise of complete capture.

Automatic service lifecycle and independent health reporting follow those checks. Optional pre-operation hooks may preserve useful pre-command states but still cannot guarantee every internal write. Conversation linking follows a reliable recorder; stronger per-write guarantees require a different capture mechanism. The prototype remains developer-only.
