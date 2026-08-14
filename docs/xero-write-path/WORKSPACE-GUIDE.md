# Where things should live

Written 14 August 2026, from what this session actually tripped over.

---

## The cost, so this isn't abstract

Every one of these came from filing, not from code:

| What happened | Why |
|---|---|
| I guessed `stza-ops` was os.stza.io. Wrong — it's a dead Next.js scaffold. | Repos scattered across three parents; a dead prototype left looking live |
| Claude Code searched the whole user tree for the spec and found nothing | Spec written to `STZA Group\portal\`, code in `astn-information-system` |
| I declared `xero_auth.py` missing and wrote a replacement | It was in `scripts/`; I listed the folder root and never recursed |
| The plugin reports dashboards as Xero organisations | Working data filed in the credentials directory |
| Two Xero credential stores drifted apart and one died for five weeks | No single answer to "where do credentials live" |
| The plugin README points at a script path that doesn't exist | Docs separated from the thing they describe |

That's the better part of a day. The mess isn't untidiness — it's a
reliability problem.

---

## Four questions that decide where anything goes

**1. Would I lose something that matters if this laptop died tonight?**
If yes, it's in the wrong place. Local disk is scratch. Nothing authoritative
lives only on C:.

**2. Is it code, or is it for a human to read?**
Code, config-as-code, specs, schemas, agent instructions → **Git**.
Client deliverables, engagement letters, board packs, signed documents →
**Google Drive**.

**3. Is it a secret?**
→ **Secret Manager. Only.** Never a JSON file, never a repo, never Drive.
One holder, always. Today's entire incident was two holders drifting.

**4. Is it generated?**
Build outputs (`.plugin` files, `dist/`, `node_modules`) are never source.
Gitignore them and rebuild. Don't file them beside the thing that makes them.

---

## The layout

### Code — one root, no exceptions

```
C:\Users\yogim\repos\
    astn-information-system\      os.stza.io — Next.js + finance-api
    stza-finance-agents\          Cowork plugin (32 skills)
    stza-xero\                    Xero plugin — retiring
    xero-reporting\               was Feldspar_Project\XERO REPORTING
    africanstn-gi\
    africanstn-research-agent\
    fx-transcript-bot\
    ASTN-sports-database\
    _archive\
        stza-ops\                 dead scaffold, kept out of the way
    README.md                     index: one line per repo, what it is
```

Rules that make this work:

- **Folder name == repo name.** Always. So a path is guessable from a repo
  and vice versa.
- **One parent.** Today they're spread across `dev\`, `STZA Group\` and the
  home root. Anything not under the code root is invisible to whoever's
  looking — human or agent.
- **Archive rather than leave.** `stza-ops` has been untouched since May and
  looks exactly like a live service. Move it to `_archive\` or delete the
  clone — it's in git either way.
- **That `README.md` index is the highest-value twenty minutes here.** It is
  the file that stops the next person, or the next agent, guessing wrong.

### Documents — Google Drive

```
STZA/
    Clients/<client>/           engagement letters, statutory accounts,
                                correspondence, signed documents
    Practice/                   templates, policies, procedures
    Board & Investors/
```

`STZA Group\Clients\` and `Data Scrapes\` on C: are candidates to move —
though check first whether `Data Scrapes` is working data (then it's scratch,
not Drive).

### Scratch — explicitly disposable

```
C:\Users\yogim\scratch\
```

One folder, understood to be deletable at any moment. If something in there
starts to matter, it graduates to Git or Drive that day.

### Secrets — Secret Manager, and nowhere else

Delete `configs\*.json` once the plugin retires. In the meantime nothing new
goes in there, and `xero_last_access_token` should be removed now — access
tokens are bearer credentials and should never be persisted.

---

## Docs live with the code they describe

`portal\spec.md` (42KB) and `claude-code-brief.md` (21KB) describe
`astn-information-system` but live in a different tree. That's precisely why
Claude Code couldn't find the spec I'd written.

```
astn-information-system\
    docs\
        spec.md
        xero-write-path.md
        decisions\              short ADRs: what we chose and why
```

Specs version with the code. When the code changes the spec changes in the
same commit, and a stale spec is visible in the diff instead of rotting
quietly in another folder.

---

## Make it legible to agents

This is the part that pays compounding returns now that Claude Code and
Cowork are doing real work in these trees.

**`CLAUDE.md` at every repo root.** You already do this unevenly —
`stza-finance-agents\CLAUDE.md` is 9.7KB and good; `stza-ops\CLAUDE.md` is
**11 bytes**. Each should say:

- What this repo is, in one sentence
- What runs where (Cloud Run service names, deployed URLs)
- Where the important code lives
- What not to touch, and why
- How to run it locally

Had `astn-information-system\CLAUDE.md` said *"this is os.stza.io; the Xero
code is in finance-api/"*, I'd have found it in one call instead of guessing
twice.

**Then tell agents where to start.** When you brief Claude Code, name the
repo path. When you brief me, connect the folder. Neither of us can search
what we can't see — which is exactly how today's spec-not-found happened.

---

## Working-directory discipline

There's a `node_modules\` and `npm-cache\` in `C:\Users\yogim\`. Something
ran `npm install` from the home directory. Always `cd` into the repo first —
stray installs at home level are how phantom dependency problems start.

---

## Doing it

Not in one sitting. In this order, because each step makes the next cheaper:

1. **`README.md` index at the code root** — twenty minutes, immediate payoff
2. **Move repos under one root** — an afternoon; close editors first
3. **Archive `stza-ops`** — two minutes
4. **`CLAUDE.md` in each repo** — thirty minutes each, highest long-term value
5. **Move `portal\*.md` into `astn-information-system\docs\`** — ten minutes
6. **Separate secrets from working data** — already on the remediation plan
7. **Drive for client documents** — ongoing, as you touch each client

Steps 1, 3 and 5 are under an hour combined and remove most of what actually
cost time today.

---

## The rule underneath all of it

**One authoritative home per thing, and it's discoverable without asking
anyone.**

Everything that went wrong today was a second copy: two credential stores,
two Xero apps, two repos that could plausibly be os.stza.io, a spec in one
tree and its code in another, a built plugin beside its source. Each second
copy was harmless when created and expensive when it drifted.

When you're about to make a second copy of something, that's the moment to
stop.
