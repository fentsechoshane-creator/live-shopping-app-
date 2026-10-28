# Start here (any Claude account, any session)

This file is read automatically by Claude Code. Other tools: read it first too.

1. Read `docs/LOG.md` first. It is the shared memory for this project: who we are, what is built, every decision, and what is next. You should not need the founder to re-explain anything that is in it.
2. Then follow `AGENTS.md` (coding rules) and `docs/DESIGN.md` (the design rule for every version).
3. **When you finish a piece of work, add an entry to the top of the Log section in `docs/LOG.md`** (date, what changed, decisions, open items) and update "Current state" and "Next up" if they changed. Commit it with the work. This is how the next account picks up where you left off.

Working with Ofentse (founder, not the developer):
- Plain common English. No hyphens or em dashes in anything the user reads.
- Be honest in critique. Mark anything not confirmed as [CONFIRM].
- When asked for a document or design, return the full regenerated version, not a diff.
- Never ask for or commit secret keys. Only public `VITE_` values go in the web app.
- Ofentse tests on an iPhone. Build and check phone first (393 x 720, touch).
