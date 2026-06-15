---
name: delete-a-slide
description: Delete or remove an entire slide from the webslides deck. Use when the user asks to delete a whole slide, remove a slide from the deck, drop a slide, or cleanly remove a slide folder and deck entry. Do not use for removing a card, section, or content inside a slide; use edit-a-slide for in-slide edits.
---

# Delete a slide

Use this skill when the user wants an **entire slide** removed from the web deck.
Do not use it for deleting one card, paragraph, visual, or interaction inside a
slide — that is an `edit-a-slide` task.

## Phase 1 — Identify the slide contract

- Get the slide id from the URL (`?slide=<slide-id>`) or from the user's
  description.
- Find the deck entry in `src/Presentation.tsx`; note its `id`, `label`,
  component import, and `cycleItems`.
- Confirm the folder is `src/components/slides/<slide-id>/`.
- Search for references to the slide id, component name, and folder path so no
  dead imports or links remain.

## Phase 2 — Remove the web slide

- Delete `src/components/slides/<slide-id>/` entirely.
- Remove the component import from `src/Presentation.tsx`.
- Remove the matching object from the `slides` array.
- Do not renumber, rename, or otherwise change remaining slide ids. Ids are
  shareable URL contracts and are not positional.
- If any neighboring slide or navigation copy explicitly referenced the deleted
  slide, update that copy only as needed.

## Phase 3 — Keep generated exports decoupled

- Do **not** update generated files in `exports/` during the delete task.
- The editable and image-based PowerPoint exports render from the live deck, so
  deleting the slide from `src/Presentation.tsx` removes it from future exports.

## Phase 4 — Verify

- Run `npx prettier --write` on changed source files.
- Run `npm run build` to catch stale imports and type errors.
- Search once more for the deleted slide id and component name. Remaining
  references should be intentional documentation/history only.
- Generated files in `exports/` should stay uncommitted.
