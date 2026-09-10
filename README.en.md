<div align="center">

# Workflow Agent Plugin

### Your AI writes code. It just doesn't manage your project.<br/>Now it does.

**Connect Claude Code, Cursor, and Codex to [Workflow](https://workflow.games) — requirements, bugs, tasks, status transitions, and live QA, all driven by your coding agent.**

![version](https://img.shields.io/badge/version-1.0.0-2ea44f) ![skills](https://img.shields.io/badge/skills-16-blue) ![spec](https://img.shields.io/badge/Agent%20Plugins-1.0.0-8b5cf6) ![API](https://img.shields.io/badge/API-OpenAPI%20contract%20as%20truth-orange) ![write](https://img.shields.io/badge/writes-read--back%20verified-red)

[简体中文](./README.md) · **English**

</div>

<!-- lumio-community:start -->
<div align="center">
<table>
<tr>
<td align="center" width="50%" valign="top">
<a href="https://qm.qq.com/q/PGkXh4tCyQ"><img src="https://raw.githubusercontent.com/LumioGames/.github/main/profile/assets/qr-qq.svg" width="170" alt="QQ group 972220164"></a><br>
<a href="https://qm.qq.com/q/PGkXh4tCyQ"><img src="https://img.shields.io/badge/QQ%20group-972220164-6171F0?style=for-the-badge&logo=tencentqq&logoColor=white" alt="QQ group 972220164"></a><br>
<sub>QQ group · anything goes</sub>
</td>
<td align="center" width="50%" valign="top">
<a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=7bbl451c-aa1d-4e6d-a21c-fd1f1ebeb6b5"><img src="https://raw.githubusercontent.com/LumioGames/.github/main/profile/assets/qr-workflow.svg" width="170" alt="Workflow community"></a><br>
<a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=7bbl451c-aa1d-4e6d-a21c-fd1f1ebeb6b5"><img src="https://img.shields.io/badge/Feishu-Workflow%20community-7C8CFF?style=for-the-badge&logoColor=white" alt="Workflow community"></a><br>
<sub>Feishu topic group · agents and project management</sub>
</td>
</tr>
</table>
<sub>Join the chat before you read the code. Other groups and the big picture are on the <a href="https://github.com/LumioGames">LumioGames profile</a>.</sub>
</div>
<!-- lumio-community:end -->

---

## What is the Workflow Agent Plugin?

**The Workflow Agent Plugin connects AI coding agents — Claude Code, Cursor, and Codex — directly to [Workflow](https://workflow.games) (workflow.games), a project management platform for game development teams.** Once installed, the agent turns a one-line request into an executable delivery blueprint and files it, reports bugs with automatic deduplication, runs QA against your real production environment, and moves ticket status based on the verdict — and **every write must be verified by reading it back** before the agent is allowed to claim success.

The plugin ships 16 skills, 13 slash commands, and 21 hard gates (G1–G7 for writes, Q1–Q7 for QA, F1–F7 for feedback). Planning and write-backs first land in `.workflow-drafts/<bundleId>/`; dependency analysis and bounded concurrent upload are handled by dedicated skills with per-operation read-back. Automated tests treat the live OpenAPI contract as the source of truth and re-check for contract drift weekly. It follows the [Agent Plugins 1.0.0](https://agent-plugins.org/) specification, is also installable as a Claude Code marketplace plugin, and is MIT licensed.

**As of 1.0.0 it also covers how the work itself gets done**: every session starts by injecting the shared rules and pulling your live tickets into a local index, and the package now carries five method skills (brainstorming, TDD, debugging, knowledge upkeep, receiving review) plus a read-only reviewer subagent, a project structure lint (`/workflow:lint`), and a scaffolder (`/workflow:init`).

---

## What problem does this solve?

**Your agent ships code, and your tracker stays empty.** It rewrites three modules in ten minutes, and nobody filed a ticket. Requirements go unrecorded, bugs go unlogged, status never moves — the AI does the work and you do the paperwork.

**Letting an AI touch your tracker API is genuinely risky.** Left unconstrained, an agent will invent fields that don't exist, file the same bug three times, leak a token into a log, or create 17 tickets in the wrong project the moment you say "sounds good."

**"Plan this feature for me" returns a chat log, not a plan.** Close the window and it's gone. Hand it to another agent and it can't act on it. A plan that can't be executed isn't a plan.

This plugin exists for all three. **It is not an "let the AI call the API" switch — it is the discipline that makes doing so survivable.**

---

## What does each skill do?

| Skill | What it does |
| :-- | :-- |
| `workflow-setup` | Onboarding: registration walkthrough, API token creation, config write, connection verification, on-the-spot 401/403 triage |
| `workflow-planning` | **Turns one sentence into an executable delivery blueprint** — decides single requirement vs. requirement room, splits delivery tracks, schedules parallel waves, writes acceptance criteria |
| `workflow-ops` | Execution: create requirements / rooms / milestones, file bugs (with dedup), query tasks, assign, transition, reopen, comment, attach, write handoff notes |
| `workflow-execute` | **Claims and delivers a ticket end to end** — finds tickets assigned to you, reads them fully (including the latest handoff notes in the owning requirement room), surfaces decision points for discussion before transitioning to in-progress, parallelizes work across sub-agents, and on completion writes evidence back in a uniform template, leaves a handoff note, then moves to review. Supports credential-less execution with a dispatcher writing back. |
| `workflow-qa` | **Runs QA in your real production environment** — reproduces bugs, retests fixes, issues a verdict, writes evidence and status back to the ticket. **Never concludes from source code.** |
| `workflow-docs` | Answers questions by fetching live docs and the OpenAPI contract — **never from memory** |
| `workflow-feedback` | **Files feedback to the Workflow platform team** — errors, poor UX, slowness, and missing features alike; collects only what you volunteered, requires verbatim confirmation before an anonymous submit, **never reads your token; the receipt is not a ticket** |
| `workflow-update` | Version self-check, sha256 verification, safe self-update |
| `workflow-dependencies` | Analyze upstream/downstream dependencies, complete direct edges, and report transitive/blocking chains with evidence |
| `workflow-upload` | Upload local bundles with permission policies, bounded concurrency, idempotent recovery, and read-back verification |
| `workflow-dispatch` | **Fans out many tickets at once, then merges them** — picks ready tickets with non-overlapping file sets from a room, dispatches each into its own git worktree, takes the diff as the source of truth, and triggers exactly one reviewer pass after the merge; findings become bugs and comments written by the main loop |
| `brainstorming` | Turns an idea into an agreed design before anyone writes code: clarifies intent, compares options, records the design as a living project doc plus a decision record, then hands off to `workflow-planning` |
| `test-driven-development` | Write the failing test first: red, minimal implementation, refactor — with an anti-pattern checklist |
| `systematic-debugging` | Four phases — root-cause investigation, pattern analysis, hypothesis testing, then the fix. **No fix before the root cause is found**; three failed attempts means question the architecture |
| `spec-steward` | After a change lands, files "what changed and why" back into the project's `.spec/`: right location, valid frontmatter, navigation and ADR index in sync, in-flight work referenced by ticket key |
| `receiving-code-review` | Verify before you change: one item at a time, each verified on its own, no performative agreement — and pushing back with evidence is allowed |

---

### Requirement references and dependency direction

Requirement associations use the native `references` API: `PUT /api/v1/requirements/{id}/references/{targetId}`
to bind, `DELETE` to unbind, and `GET /api/v1/requirement-graph` to verify. The relation is undirected and
idempotent; graph `source` / `target` are only a stable display order and do not mean upstream/downstream.
`workflow-dependencies` remains authoritative for `upstream -> downstream` direct edges, transitive and blocking
chains, and evidence. The uploader binds only direct edges and verifies the graph by unordered UUID pair.

---

### Session hooks and the local ticket index

Once installed, **every session start** (launch, resume, `/clear`, post-compaction) runs two things without you typing anything:

**1. Inject the shared rules.** Everything under `rules/` enters the context — how to dispatch, how to close out, what is never allowed. The rules are a plugin asset and travel with the plugin version, so **projects must not keep their own copy** (`/workflow:lint` reports it as "project copied the plugin" if they do).

**2. Pull your live tickets into a local index.** It lands in `$XDG_CACHE_HOME/workflow/index/<host>.json` (`~/.cache` when XDG is unset) — never in your repo, never in the plugin root. The rules are deliberate:

- **No refetch within 15 minutes**, and a failure occupies that window too — otherwise every offline session start would burn a full timeout;
- **One full re-alignment per day** (enumerating requirements room by room); everything else is incremental;
- **Offline means reuse the previous snapshot**, stamped with the reason and time, exit code always 0 — the index is a convenience, not a gate;
- **Only one line of counts enters the context** (path, item count, per-room counts, how long ago it refreshed). The body never does: when the agent needs a ticket key it greps that file itself, so a board with thousands of tickets costs you nothing in context budget;
- **The index is for finding ticket keys and rooms; status comes from the server** — always fetch transitions live, never act on the `status` cached in the index.

To refresh immediately (say, right after filing a batch), run `/workflow:index` — it ignores the 15-minute window. With no `.workflow` marker in the current directory it fetches nothing and says nothing; run `/workflow:setup` to bind the project first.

### Structure lint and scaffolding

**`/workflow:lint` — a structure check on the project's `.spec/` that reports without blocking.** Exit code is always 0 by default: findings are a to-do list, not a gate, and committing with findings open is fine. Only `--strict` exits 1 on errors (for CI), and `--json` prints a machine-readable result. The order is fixed and the report is one report:

1. **Universal checks** — core files, frontmatter, navigation and ADR index coverage, link reachability, `@import` completeness, symlink health, duplicate ADR numbers and status lines, no parallel doc roots;
2. **Project extension** — the optional `.spec/tools/lint-extensions.mjs`, loaded when it exports `api = 1` (a version mismatch is an **error**, never a silent skip). This is where a project adds its own checks;
3. **Fingerprint** — if the project's `AGENTS.md` or `rules/` contains one of the plugin's reserved headings, or three consecutive lines identical to the plugin's rules, it reports "project copied the plugin." The shared rules are injected every session; a second copy only drifts.

**`/workflow:init` — generates the project-specific half.** Only "what this project is and what it has decided": `.spec/AGENTS.md`, `.spec/rules/system.md` (an empty template for project-only red lines), `.spec/knowledge/README.md` and the feature-doc template, `.spec/decisions/README.md`, a sample `.spec/tools/lint-extensions.mjs`, and the root `CLAUDE.md`. It never overwrites existing files by default, so re-running it after a plugin upgrade just fills in new templates. It does **not** write `.workflow` and does **not** mint a token — binding a project is `/workflow:setup` — and it creates no local task directory, because Workflow is the only source of truth for tasks.

The same check runs in CI without installing the plugin:

```bash
npx github:LumioGames/workflow-plugin spec-lint . --strict
```

### The reviewer subagent

`agents/reviewer.md` is a **read-only adversarial reviewer**: assume the delivery is broken, then try to prove it. Three constraints are baked in:

- **Reviews after the merge; never blocks it.** Merging only guards "it compiles." The findings are a to-do list for the main loop — file, fix, re-review — not a rollback gate.
- **No Bash.** It runs no tests, no lint, no build, and touches no git. The main loop hands it the diff as a file; it reads changed files on demand.
- **Report only.** No transitions, no ticket creation, no comments, no code changes — the main loop turns findings into bugs and comments so there is exactly one writer.

Why a separate context at all: **the author and the reviewer must be two contexts.** Reviewing your own output does not work.

---

## How do I install it?

This repository is simultaneously an **[Agent Plugins 1.0.0](https://agent-plugins.org/)** package and a Claude Code marketplace — the repository root is the plugin root, so both ecosystems install it directly.

**Agent Plugins clients** (Cursor, Codex, Copilot, VS Code, Kiro, …)

```bash
npx plugins add LumioGames/workflow-plugin
```

**Claude Code**

```bash
/plugin marketplace add LumioGames/workflow-plugin
/plugin install workflow@workflow-plugin
```

**Codex / manual install**

```bash
curl -fsSL https://workflow.games/plugin/install.sh | bash
```

> Installs to `~/.codex/skills` by default; use `--target ~/.claude/skills` or `--target .agents/skills` for a project-level install.

No account yet? Just tell the agent **"connect me to Workflow"** — `workflow-setup` walks you through registration, token creation, config, and verification.

You get thirteen commands: `/workflow:setup`, `/workflow:plan <description>`, `/workflow:bug <description>`, `/workflow:take <ticket>`, `/workflow:qa <ticket>`, `/workflow:deps <ticket-or-bundle>`, `/workflow:upload <bundle>`, `/workflow:policy <show|set>`, `/workflow:feedback <description>`, `/workflow:update`, plus `/workflow:init`, `/workflow:lint`, and `/workflow:index`, new in 1.0.0.

> **If you installed the `lumioagentspec` plugin**: all of its functionality is now part of this plugin as of 1.0.0, and running both injects the rules twice — so while it is still enabled, every session start prompts you to uninstall it.

---

## What does it look like in practice?

### One sentence to an executable blueprint

```
/workflow:plan the battle results screen should show score and drops
```

The agent reads your input, your repo's `AGENTS.md` / `CLAUDE.md`, design docs, and existing implementation. It **asks one question at a time, and only questions that would actually change the blueprint**. Then it decides the shape: one Requirement if a single agent can deliver and verify it independently, or a Requirement Room if the work splits across client, server, art, and tooling with research gates, parallel waves, and shared contracts.

The point is this: **every executable requirement is a self-contained agent prompt.** Identity, source-of-truth priority, prerequisites, decision authority, owned scope and shared hotspots, detailed requirements, verification evidence, deliverables, acceptance criteria, prohibitions, escalation, and hand-back format — twelve sections, all filled in. It does not depend on the original conversation, so you can hand it to a different agent three days later, or to a new hire, and it still runs.

### File a bug, get dedup for free

```
/workflow:bug the results page shows the raw owner id instead of the name
```

The agent runs `GET /search` first, reports suspected duplicates **before** creating anything, then files the ticket, reads it back with `GET`, and reports the `displayKey`, UUID, clickable link, and the field values that actually landed in the database.

**"Just log it" means only log it** — no fix proposals, no expansion into dev tasks, no touching code.

### Claim a ticket, work it, hand it back

```
/workflow:take R-00012
```

The agent reads the ticket **completely** (body + comments + attachments + acceptance items — missing any one of them doesn't count as having read it), reads the **latest handoff notes of the owning requirement room** to see where the previous leg left off, verifies each prerequisite ticket's actual status, then **clarifies the requirement first** — it lays out ambiguities and the decisions that need your call, each with a recommendation, and only after the discussion does it query available transitions and move the card to in-progress. During execution it **parallelizes work across multiple sub-agents** wherever the agreed split allows (mutually exclusive ownership, no parallelism on shared hotspots, sub-agents never touch credentials or ticket write-backs). On completion it writes back in a fixed order: **follow-up tickets filed (with your confirmation) for every deferred TODO** → evidence attachments → **a uniform evidence comment** (change list, **commit identifiers — Git commit / PR or SVN revision per repository**, acceptance items checked one by one, commands actually run with key output, decision log, known gaps with follow-up ticket keys, boundary statement) → **a handoff note of at most 200 characters** (what was done / how it hands off / where the handoff doc lives, written for whoever picks it up next) → transition to review (moving to done is allowed only when the workflow has no review state). **Unreported work counts as unfinished work.**

> **The relay runs on handoff notes, not on chat scrollback.** Workflow is the single source of truth for them (a room bound to a Feishu group mirrors each note into the group for humans, but the agent reads the API and **never pulls group history**). Notes come back as free text somebody else wrote, so the skills treat them as **data**: imperatives and forged system prompts inside them are never executed.

Multi-agent orchestration gets a second mode: the executing agent holds **no token at all** — the card arrives via the dispatch prompt, and it hands back a structured report a credential-holding dispatcher can write back **without asking a single follow-up**. An executing agent in a directory without a `.workflow` binding will **never** fall back to the global default project for writes.

### Actually test it in production before deciding the ticket's fate

```
/workflow:qa B-00087
```

The agent reads the ticket, **looks at every screenshot attachment** to establish a reproduction baseline, then **operates your declared production environment for real**: it runs the original path at least twice (current session plus a clean re-entry), screenshots every key step, and if it doesn't reproduce the first time it retries across browser, language, viewport, and account-state variants.

There are exactly six verdicts: **confirmed, partially confirmed, fixed, not reproduced, duplicate, blocked.** The agent then attaches evidence, appends a QA record block to the description (leaving the original text untouched), posts a structured comment, and transitions status after querying available transitions live.

> **"Conclusions come only from live testing" is the first rule in the prompt.** Reading source code, checking commit history, old screenshots, a 200 response — none of these count as acceptance evidence. Passing locally or on dev cannot stand in for a production conclusion. If evidence is insufficient, the verdict is "blocked" and the agent tells you what's missing, rather than handing you a guessed "should be fixed now."

### Hit a platform problem? Report it in one line

```
/workflow:feedback the requirements list takes over ten seconds to load
```

The agent assembles **only what you volunteered** (no repo scanning, no credentials), shows you the full report, target host, attachment list, and do-not-send list **verbatim for confirmation**, and only then submits anonymously to the platform's support inbox. The returned `sup_` id is **a pending intake receipt, not a ticket** — and the agent says so instead of claiming "ticket created."

**Errors, poor UX, sluggish loading, missing features, product suggestions — all reportable**, not just bugs.

---

## Why is it safe to let this write to your production tracker?

This is where most of the engineering went.

**Two-gate authorization.** Approving blueprint content and authorizing a production write are two separate gates. Saying "looks good" only approves content. To actually file, the agent must first show the target project, blueprint revision, dedup results, and the **exact object count**, then ask explicitly whether to write. Any change in scope voids the authorization immediately.

**Read-back is mandatory.** Every POST/PATCH is followed by a forced `GET`. **Without read-back evidence, the agent may not say "created."** Partial success is reported as partial success, listing exactly what landed and what didn't.

**Idempotent recovery.** On a dropped connection or 5xx, the agent checks whether the object already exists before retrying. Objects that succeeded are never recreated — only missing sub-resources are filled in. No duplicate tickets.

**It cannot write to the wrong project.** Before any write, the agent cross-checks `project.subdomainPrefix`, the actual API host, and the profile bound in `.workflow`. Mismatch means **stop**. A `.workflow` file that exists but won't parse also means **stop** — it never silently falls back to the global default project.

**Tokens never leak.** Credentials travel only through environment variables, never as command-line plaintext. Every output — reports, logs, errors — refers to a token only as `wfp_` plus its first 8 characters.

**Fields come from the contract, not from memory.** Platform-specific workflow states, acceptance types, and custom bug fields are always queried live. If a value can't be found, the agent leaves it blank and tells you — **it does not guess a value and write it**.

**QA verdicts never come from code.** Live acceptance accepts only live evidence, and QA never modifies production business data for the sake of a screenshot: anything involving real charges, deletion, or account closure requires separate authorization.

> One more boundary is hard-coded: **filing is not starting work.** During planning and filing, the agent creates only the PM objects and acceptance items you authorized — no work items, no status transitions, no worktrees, no running your repo's tests, no code changes.
>
> **There are exactly two exceptions, each with a hard-coded scope.** `workflow-qa` is authorized to test and to transition status on its verdict — changing code, changing assets, creating branches, deploying, and fixing bugs all remain forbidden; **QA does not fix**. `workflow-execute` is authorized to transition **the one ticket it claimed** and to write completion evidence back — transitioning other tickets, expanding a claim into filing new tickets, editing the original description, and accepting its own delivery all remain forbidden.

---

## How do I use one machine with multiple projects?

Install the plugin once, globally. There is no need to reinstall per project.

```
~/.config/workflow/config.toml     one [profiles.<name>] section per project, each with its own token
<your repo>/.workflow              profile = "<name>", no token, safe to commit and share
```

Credentials resolve in three tiers: **environment variables → the `.workflow` marker → the global `current_profile`**. **Whichever directory you work in determines which project you're connected to** — no manual switching. If your config has multiple profiles and the current directory isn't bound to one, the agent stops and asks rather than guessing. Ticket execution is stricter still: **in a directory without a `.workflow` binding, an executing agent must not fall back to the global default project for writes** — it either binds first or hands the write-back to the dispatcher.

For live QA, `.workflow` can carry an **optional** `[qa]` table declaring the environment under test and the **environment variable names** holding test credentials:

```toml
profile = "my-project"

[qa]
base_url = "https://<your production site>"
entry_path = "/login"
username_env = "QA_USER"
password_env = "QA_PASS"
surfaces = ["web"]
```

**Only variable names, never the username or password itself** — this file is meant to be committed. If `[qa]` is absent, the QA skill stops and asks; it never guesses the environment under test.

---

## How do I update it?

| Install method | How to update |
| :-- | :-- |
| Claude Code (marketplace) | `claude plugin marketplace update workflow-plugin` + `claude plugin update workflow@workflow-plugin --scope user` (restart the session afterwards); autoUpdate and the `/plugin` UI also work |
| Agent Plugins client | Re-run `npx plugins add LumioGames/workflow-plugin` |
| Codex / manual | Tell the agent "update the workflow plugin" — checks the published version, verifies sha256 per file, backs up the old version, installs |

Self-update downloads only from the `workflow.games` domain, and the skill package may contain only `.md` and `VERSION` plain-text files — **any executable in the manifest aborts the update with a warning.**

---

## FAQ

### Which AI coding tools does the Workflow Agent Plugin support?

Claude Code, Cursor, and Codex, plus any client implementing the [Agent Plugins 1.0.0](https://agent-plugins.org/) specification (Copilot, VS Code, Kiro, and others). Claude Code installs via marketplace, Agent Plugins clients via `npx plugins add LumioGames/workflow-plugin`, and Codex via the install script.

### How is this different from an MCP server?

The Workflow Agent Plugin is a **skill package, not an MCP server**. It runs no persistent process and consumes no tool slots. It is a set of Markdown prompts the agent reads on demand, then calls the Workflow REST API using its own HTTP capability. The tradeoff is that your agent needs network access; the benefit is zero runtime dependencies and fully auditable behavior — you can read exactly what constrains it.

### Is it safe to let an AI write to a production project tracker?

The plugin constrains every outbound write with 21 hard gates. Before writing to your project, it verifies that `project.subdomainPrefix`, the live API host, and the profile bound in `.workflow` all agree, and stops if they don't. Every POST/PATCH is followed by a mandatory `GET` read-back, and **without read-back evidence the agent may not claim success**. Tokens travel only in environment variables and appear in output only as `wfp_` plus 8 characters.

### Do I need a Workflow account before installing?

No. After installing, tell your agent "connect me to Workflow" and the `workflow-setup` skill walks you through registration, creating a project API token, writing the config, and verifying the connection — including live triage if you hit a 401 or 403.

### Does workflow-qa really test in production, or does it infer from code?

It operates the production environment for real. The first rule of `workflow-qa` is that **conclusions come only from live testing** — source code, commit history, old screenshots, and a 200 API response are explicitly not acceptance evidence. It runs the original path at least twice, records a reproduction rate, and must attempt variant retries before it may report "not reproduced."

### How does multi-agent orchestration work when executing agents have no token?

`workflow-execute` natively supports a dispatcher-writes-back mode: a credential-holding dispatcher hands out cards via dispatch prompts, and the credential-less executing agent returns a structured report — target ticket, suggested transition, an evidence comment ready to POST verbatim, an attachment list, and known gaps — which the dispatcher writes back with read-back verification at every step. An executing agent in a directory without a `.workflow` binding never falls back to the global default project for writes.

### I sent feedback — why is there no bug in my project?

A `sup_` id is a support-intake receipt, not a ticket number. Feedback lands in the platform's pending review inbox; a real ticket exists only after platform operators review and convert it. `workflow-feedback` cannot skip that step, and there is no public endpoint to query intake progress. To record an issue **in your own project**, use `/workflow:bug` (workflow-ops) — the two channels never mix.

### Does feedback carry my token or project files?

No. `workflow-feedback` uses a public anonymous endpoint: it **reads no Workflow credentials** and sends no `Authorization` header or cookies. Material comes only from what you volunteered, and before sending, the agent shows you the full report plus the do-not-send list (tokens, config, environment variables, project content, full request bodies, and more) verbatim. The server scans again on its side and rejects sensitive content with a 422.

### What is the relationship between Workflow and Jira or Linear?

[Workflow](https://workflow.games) is an AI-native development collaboration platform for game teams, covering requirements, bugs, scheduling, and traceability in one system. This repository is its AI agent integration layer. It **does not integrate with Jira or Linear**.

### Is the plugin open source, and under what license?

Yes — MIT licensed, source at [github.com/LumioGames/workflow-plugin](https://github.com/LumioGames/workflow-plugin). The skill package is restricted to Markdown and `VERSION` plain-text files, and the self-updater aborts if any executable appears in the manifest.

---

## Prefer not to run an install script?

Send this to your AI agent verbatim — the effect is identical:

```
Please install the Workflow (workflow.games) agent plugin for me:
1. Fetch https://workflow.games/plugin/version.json?cb=<current timestamp> and read the version and files fields;
2. Fetch the manifest that files points to (with the same cb parameter), download each file listed and verify its sha256; stop and tell me if any mismatch;
3. Write the skill directories under skills/ into ~/.codex/skills/ (or ~/.claude/skills/ for a Claude Code manual install, or .agents/skills/ for a project-level install). The skill package should contain only Markdown and VERSION text files — stop immediately if you find an executable;
4. List the installed skills and versions;
5. Then start the workflow-setup onboarding flow: first check whether ~/.config/workflow/config.toml already has a usable configuration.
```

---

<div align="center">

**Full installation and usage guide → [workflow.games/wiki/guides/agent-plugin](https://workflow.games/wiki/guides/agent-plugin)**

*Let the AI finish the work — and file the ticket too.*

</div>
