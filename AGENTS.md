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
