# Independent Recovery

Recovery records observed files from explicitly enrolled local projects, independently of agents, their editing tools, and Git commits. It is included in the installed ConClear package. Requires Node.js 22.13 or later.

## Start

```bash
conclear recovery add /absolute/project/path
conclear recovery status
```

Enrollment installs and starts a per-user background service: launchd on macOS, systemd --user on Linux. It starts at user login and restarts after a process crash. No administrator service is installed. Linux requires a working user systemd session; Windows can use foreground operation. A failed service installation is reported explicitly and must not be interpreted as active capture.

For foreground operation, use `add /path --no-service` followed by `conclear recovery run`. Closing that process stops capture. An installed observer keeps running when the CLI, browser, or agent closes. `CONCLEAR_HOME` overrides the default `~/.conclear` data directory; use the same value for all commands.

The web UI **Recovery** page provides enrollment, service control, per-project capture health, policy settings, captured points, pinning, and restoration. Session `--demo` mode disables recovery management and does not enroll real projects. The read-only MCP tool `conclear_recovery` returns health, or paginated points when given a `projectId`.

## Inspect and recover

```bash
conclear recovery list --json
conclear recovery snapshots PROJECT_ID --limit 50 --offset 0 --json
conclear recovery pin PROJECT_ID POINT_ID --reason "Reviewed working version"
conclear recovery restore PROJECT_ID POINT_ID /new/recovered-directory
conclear recovery unpin PROJECT_ID POINT_ID --reason "No longer needed"
```

The restore destination must not exist and must be outside the original project and recovery store. All referenced objects are hash-verified before restoration. The original workspace is not modified. A restored directory contains included regular files and basic permission bits; empty directories, ownership, timestamps, extended attributes, and symlink targets are not preserved.

## Storage and coverage

The default preserves published history and pauses new captures at a 512 MiB payload budget or 200 points. A busy project can reach 200 points quickly. Status and UI expose storage exhaustion; raise limits to resume. No notification is injected into model context, and a closed UI cannot notify the user. Inspect status before relying on coverage.

```bash
conclear recovery configure PROJECT_ID --max-bytes 1073741824 --keep 1000
conclear recovery configure PROJECT_ID --retention expire
conclear recovery configure PROJECT_ID --exclude .env,.env.local,build
conclear recovery pause PROJECT_ID
conclear recovery resume PROJECT_ID
```

Expiration is an explicit opt-in and can immediately delete older unpinned points. The earliest baseline, newest point, and pins remain protected. Lowering limits cannot force deletion of protected history. Pins require a reason; reasons and optional source references are declarations, not proof of correctness. Pausing or removing the service never deletes history.

Always excluded: `.git`, `node_modules`, `dist`, `.DS_Store`, symlinks, special files, and files over 16 MiB. Enrollment additionally excludes `.env` and `.env.local` by default. Additional exclusions are exact relative paths or subtrees, not glob patterns. `.gitignore` is not applied. All other included content is stored as bytes, without secret redaction or encryption. Stores live under `~/.conclear/recovery/stores/` with private filesystem permissions. The payload budget excludes metadata, lock databases, logs, filesystem overhead, and restored copies.

## Service and health

```bash
conclear recovery service status
conclear recovery service install    # install / repair current executable paths
conclear recovery service start
conclear recovery service stop       # stops until started again or next login
conclear recovery service uninstall  # removes startup; history stays
```

Status combines process liveness and a fresh observer heartbeat with each project's capture state. It distinguishes offline, paused, starting, observing/limited, errors, and full storage. Full reconciliation has a separate timestamp from changed-path capture. Persisted failure counts and interruption details survive restart. A service running is not evidence that every project is capturing successfully. If Node or ConClear moves after an upgrade, run service install again to repair its executable paths.

**No promise of complete capture:** filesystem notifications are hints. Rapid intermediate writes may disappear before observation, and reconciliation cannot recover overwritten bytes it never saw. Baseline capture takes time. No coverage exists while offline, paused, full, before enrollment, or on another machine. Points are observations made at different times across files, not atomic or certified working project states. Recovery reduces a specific failure mode; it does not replace source control or backups.

## Validation

The packed CLI has been exercised on macOS with a temporary actual login service: startup, continued observation after CLI exit, file overwrite/deletion, exclusion, pinning, hash-verified restoration, SIGKILL restart, pause/resume, stop, and uninstall. Linux service generation and command arguments have automated tests; Linux login-manager lifecycle is not represented by the macOS check. Engine tests cover crash boundaries, quota pauses, expiration, corruption, cross-process restoration, and notification capture. See [engine measurements](recovery-prototype.md) for dated workload evidence and remaining coverage limits.
