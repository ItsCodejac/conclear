# ConClear — Admin Panel Feasibility Notes

> Handoff doc for engineering. Each admin feature below maps to the data it needs and an
> honest feasibility read. **These are design mockups, not implemented.** Mock data lives in
> `app/data-admin.js`; the UI in `app/admin.jsx`.

---

## The one prerequisite everything depends on

Today ConClear is **100% local** — a server you run on your own machine, reading your own files.
Every admin feature assumes one new thing exists:

> **A central service + an authenticated sync client inside each member's local ConClear.**
> Members link their machine to an org; the local agent pushes **metadata only**; the admin
> console reads aggregated metadata back.

**Hard privacy constraint (also the sales pitch):** raw session content — conversations, code,
screenshots, and the actual secret *values* — **never leaves the machine**. Only derived
metadata syncs. Scope the work as "sync small metadata records + push config down," never
"upload sessions."

Two capability tiers sit on top of that:
- **Sync (read path):** agent reports metadata up. Lower risk.
- **Agent (control path):** agent receives config/commands and acts on the machine. This means
  ConClear must run as a **persistent, centrally-managed background process**, not an app you
  launch. This is the real architectural shift and the main thing to scrutinize.

---

## Feature-by-feature

| # | Feature | What it does | Data / mechanism needed | Dependency | Feasibility |
|---|---------|--------------|--------------------------|------------|-------------|
| 1 | **Workspace / membership** | Org identity, roles (Owner/Admin/Member), switch personal↔org | Accounts, org model, invites, auth | Standard SaaS | ✅ Doable |
| 2 | **Overview** | Aggregate tiles: open leaks, seats, spend, compliance %, activity | Rollups of metadata other sections already sync | Derived | ✅ Trivial once data flows |
| 3 | **Leaks dashboard** | Org-wide secret findings: type, severity, member, project, age, status; ack/resolve; CSV export | Local secret scanner (already exists) pushes a **finding record** `{type, severity, project, timestamp, status}` — **never the secret value**. Status writes back. | Sync | ✅ Very feasible — scanner exists; small metadata |
| 4 | **Policies (enforced)** | Auto-redact secrets, auto-resize >2000px, retention/archive after N days, block high-sev sessions; "Enforce" = can't disable locally; pushed to fleet | Central policy config + agent receives & applies it to local ops. Actions (strip/resize/redact) already exist locally. | **Agent** | ⚠️ Moderate–hard. "Enforce / can't disable" needs the managed background agent |
| 5 | **Fleet** | Per-machine inventory (name, version, MCP on/off, last sync) + **push-install to a machine** | Agents report status (easy). Push-install needs a **remote control channel** (agent polls for commands) | **Agent** | ⚠️ Status = easy. **Remote "push install" is the hardest item** — MDM-like. Consider "send install instructions to member" as the v1 fallback |
| 6 | **Members (seats/roles)** | Invite, assign roles, deactivate; per-member sessions / spend / open-leaks | Membership model + synced per-member rollups | Standard SaaS | ✅ Doable |
| 7 | **Usage (cost)** | Total + per-member token/cost spend, top spender | Agents report usage | Tool-dependent | ⚠️ **Caveat:** only some tools expose per-session cost today (Cline/Roo do; Claude/Cursor/etc. may not). Accurate where available, estimated otherwise. Confirm per-adapter |
| 8 | **Audit log** | Immutable governance log (who redacted/changed policy/invited/exported) + SOC2/GDPR "evidence pack" + CSV | Append-only store of admin/agent actions; "pack" = report generator over the log | Sync | ✅ Feasible. SOC2/GDPR "pack" = auditor-friendly export formatting, not magic |
| 9 | **Billing** | Current plan, seat meter, plan comparison, billing portal | Billing provider (Stripe-style) + seat counting | Standard SaaS | ✅ Doable |
| 10 | **Enterprise items** | SSO/SAML, SCIM, **self-hosted metadata sync**, data-residency, SLA | SSO/SCIM are standard-but-real. Self-host + residency = your own infra deployment | Enterprise infra | ⚠️ SSO/SCIM doable; **self-hosted sync + data residency are the heaviest lift** (usually justifies the "Custom" price) |

---

## Summary for scoping

- **Easy / standard cluster:** Workspace, Overview, Leaks, Members, Audit, Billing.
- **Scrutinize these two — they require a persistent managed agent (control path), not just sync:**
  1. **Enforced policies** (#4)
  2. **Remote "push install"** (#5)
- **Tool-dependent:** org-wide **cost** (#7) is only as complete as each adapter's usage data.
- **Heaviest enterprise infra:** self-hosted sync + data residency (#10).

## Data model touchpoints (from the existing local backend)
The local capabilities these features build on already exist in the codebase:
- `scanSecrets` → severity-tagged findings (powers #3).
- `stripImages` / `resizeImages` / redaction → the actions policies (#4) automate.
- `Session.usage {tokensIn, tokensOut, cost}` → powers #7 (currently Cline/Roo only).
- `capabilitiesOf(adapter)` → which tools support what, per member/machine.
- The `conclear install` / `doctor` system → relates to Fleet (#5) install status.

The new surface is the **sync service + linked-agent**; the local primitives are largely in place.
