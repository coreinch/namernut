<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design Process (workflow to follow for feature/design work in this project)

For any non-trivial feature, UI, or design task in this repo, work through this cycle rather than jumping straight to code:

1. **Define** the problem — state exactly what is being solved before writing code.
2. **Collect** information — read the relevant existing code, docs (including `node_modules/next/dist/docs/` per the rules above), and any user constraints.
3. **Brainstorm & Analyze** ideas — consider more than one approach before committing to one.
4. **Develop** — build the solution / a working model.
5. **Present** — show the result to the user (diff, screenshot, or running demo) for feedback before considering it done.
6. **Improve** — incorporate feedback and iterate; treat this as a loop back to step 1 for the next refinement, not a one-shot process.

# Autonomous improve-loop operating rules

The following were given directly by the project owner while running the recurring "improve namernut" autonomous loop. They govern how that loop (and any similarly autonomous session) should operate, and take precedence over the Design Process's "present to the user for feedback" step for that context specifically — the point of the loop is to ship improvements continuously, not to pause it on each one.

- **Commit and push improvements when done.** Don't hold a finished, verified fix waiting for separate approval — ship it.
- **Decide autonomously; don't ask clarifying questions.** Make the reasonable call yourself and implement it, rather than stopping with a question. Reserve pausing for genuine blockers: missing credentials, an action outside the tool's normal scope, or something destructive/irreversible that can't be decided on the user's behalf (ordinary safety-critical-action judgment still applies and isn't overridden by this).
- **Move time-consuming tasks to the background** rather than blocking on them synchronously.
- **Don't wait for CI, and don't watch it.** Push and move on; don't launch or maintain background processes just to babysit a pipeline run.
- **Don't bother with tests.** Don't reflexively run the full local verification suite (lint/typecheck/test/build) before every small commit — CI already gates it. This also means don't spend effort authoring new test cases for every fix; a quick typecheck/lint sanity pass is enough before pushing.
- **When live-testing via browser automation, block brandability checks unless brandability itself is what's being tested.** The app auto-fires a metered brandability check (LLM + search-provider calls) for every "found" result during a live search; override `window.fetch` to short-circuit `/api/brandability` requests before running a test search for anything else.
- **Never run a destructive/mutating action against the live production site's persisted state** (e.g. `localStorage.clear()`) to check a UI state — use a fresh/incognito browser context, or reason from source, instead.
