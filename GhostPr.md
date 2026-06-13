# PRD: GhostPr

### Decision Memory That Gets Smarter Over Time

---

## The Problem

Vibe coding is dead. The industry has moved to Agentic Engineering — developers as managers, AI as executor. But there's a gap nobody has solved:

Agentic IDEs know *what* your code does. They have zero memory of *why* it exists.

Every session, the AI re-infers patterns it figured out last week. Every refactor risks destroying a workaround that exists for a non-obvious reason. Every junior dev asks the same question senior devs answered six months ago.

**The AI knows your code. It doesn't know your history. And it definitely doesn't know which parts of that history are still valid.**

---

## What Already Exists (and Why This Is Still Needed)

ByteRover and MemU offer persistent memory for agentic IDEs — but they optimize for context retrieval: what files are relevant, what conventions exist.

GhostPR is different. It is not a context retrieval tool. It is a **living decision audit layer** — one that doesn't just remember decisions, but tracks whether they still hold up.

---

## The Solution

GhostPR is an MCP server that plugs into any agentic IDE (Cursor, Windsurf, Claude Code). It watches PRs, issues, and Slack threads, builds a memory of decisions, and then continuously updates the confidence of each decision based on observed outcomes.

When the AI is about to touch a file with decision history, GhostPR surfaces a warning card — with a health status that tells you whether that decision is still trustworthy.

---

## The Core Loop

```
PR merged / Issue closed / Slack thread resolved
        ↓
Decision extracted and stored
        ↓
Outcome observed over time
(subsequent PRs, test results, incidents, Slack mentions)
        ↓
Confidence score updated
        ↓
Future warning card becomes stronger or weaker
```

This is what separates GhostPR from every other memory tool: **decisions age**. A workaround from Sprint 12 that hasn't been validated in 8 months is not as trustworthy as one that was reconfirmed last week. The system knows the difference.

---

## Decision Health System

Every stored decision gets a health status, continuously updated:

| Status | Meaning |
|---|---|
| ✅ Healthy | Decision confirmed by recent outcomes or revalidated |
| ⚠ Questionable | No validation in 3+ months, or conflicting signals observed |
| 🔴 Outdated | Underlying condition likely changed (API updated, dependency removed) |
| ⬛ Deprecated | Explicitly marked resolved; decision no longer applies |

Health degrades automatically over time without revalidation. It improves when outcomes confirm the decision was right.

---

## The Warning Card

When the AI is about to edit a file with decision history:

```
⚠ Historical Context

File:      auth/session.ts
Decision:  Keep custom OAuth refresh flow
Created:   Sprint 12
Outcome:   Worked — reduced auth failures by 94%
Status:    ⚠ Questionable
Reason:    No validation in last 8 months.
           HDFC Bank may have updated their API.
           Recommend re-testing before modifying.
Source:    PR #143 · @priya
```

A Healthy decision gets a soft advisory. A Questionable decision gets a clear warning. An Outdated decision gets a hard stop recommendation. The AI agent sees all of this as injected context before writing a single line.

---

## Three Features (Nothing More)

### 1. Decision Capture
Ingests GitHub PRs, issue comments, and Slack threads. Extracts decisions — not activity, not conventions, but the specific moments where your team chose to do something and why. Stores: decision, reason, file/module, source link, date, initial outcome.

### 2. Decision Health Tracking
Each decision gets a confidence score that evolves over time. Subsequent PRs, test failures, incident reports, and Slack mentions are scanned for signals that confirm or contradict the decision. Health status updates automatically.

### 3. Pre-Edit Warning Cards
MCP server intercepts file edits in any agentic IDE. Queries memory for that file path. Injects the warning card — with current health status — into the AI's context window before it touches the code.

---

## Demo Flow (60 seconds)

1. Show a codebase with a non-obvious auth implementation.
2. Show the GhostPR dashboard — the decision card for that file, status: Questionable, reason: no validation in 8 months.
3. Trigger an agentic edit in Cursor targeting that file.
4. GhostPR injects the warning card. The AI pauses and surfaces the context.
5. Show what happens without GhostPR: AI confidently refactors the workaround. Auth breaks.
6. Fast forward — show a decision moving from Questionable → Healthy after a PR confirms the fix still works.

That last step is the money shot. **The memory got smarter.**

---

## What This Is NOT

- Not a code documentation tool
- Not a convention enforcer
- Not a general-purpose memory layer
- Not another RAG system over your codebase

One job: **remember decisions, track whether they're still valid, warn before the AI touches them.**

---

## Stack

- Hindsight (Vectorize) — memory backend + confidence tracking
- GitHub API + Slack API — ingestion and outcome signal detection
- MCP server — IDE integration (Cursor, Windsurf, Claude Code — any MCP-compatible IDE)
- Groq / Claude — decision extraction from raw PR/Slack text
- Next.js — minimal dashboard to browse decision health

---

## Judging Criteria Fit

| Criteria | Why GhostPR Wins |
|---|---|
| Innovation (30%) | Nobody does self-updating decision confidence for agentic IDEs. ByteRover stores context. GhostPR tracks whether that context is still true. |
| Use of Hindsight Memory (25%) | Memory is the entire product. The health loop is only possible because memory persists and compounds. |
| Technical Implementation (20%) | Tight scope: ingestion pipeline + confidence scoring + MCP injection. Clean, demonstrable, completable in a hackathon. |
| User Experience (15%) | Zero friction. Devs use their IDE normally. The warning appears exactly when it matters. |
| Real-world Impact (10%) | Every team using agentic coding has broken something because the AI didn't know why the code was there. This prevents that. |

---

*Decisions age. GhostPR knows which ones you can still trust.*