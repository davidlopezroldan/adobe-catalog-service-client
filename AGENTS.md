# Agent instructions (Claude Code, OpenCode, etc.)

Static web panel (HTML + CSS + JS, no build, no dependencies) to query Adobe Catalog Service. See `README.md` for features and structure.

## Changelog (mandatory before every commit)

`README.md` has a `## Changelog` section: a list of changes grouped by date (`### YYYY-MM-DD`), newest first.

**When a task is finished and BEFORE running `git commit`:**

1. Remind the user that the changelog must be updated and propose the entry.
2. Add the entry to `README.md` under today's date heading (create it at the top if it does not exist).
3. Format: one bullet per change, in English, plain text with a capital first letter, no `feat:`/`fix:`/`docs:` prefixes and no commit hashes.
   - Example: `- Add favorite attributes pinned first in attribute lists`
4. Include the `README.md` change in the same commit.

Do not commit without having updated the changelog (unless the user explicitly says it is not needed).

## Commits

- Conventional Commits style, in English (`feat: ...`, `fix: ...`, `docs: ...`).
- Do not add any reference to the AI in commits or PRs (no `Co-Authored-By`, no "Generated with ...").
- Only commit when the user asks for it and, if you propose the title, wait for their confirmation.

## Documentation

If a change adds or modifies a user-visible feature, also update the feature list in `README.md`.
