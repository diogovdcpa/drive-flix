# Repository Guidelines

## Instruções do projeto
- Sempre responda ao usuário em português do Brasil neste projeto.

## Project Structure & Module Organization
- `manifest.json` defines the Chrome Extension manifest, permissions, and content script injection.
- `content.js` contains the Drive page scanning logic, overlay/modal behavior, and navigation state.
- `styles.css` holds all UI styling for the floating button, grid, modal, and responsive layout.
- `README.md` is currently minimal; use it for user-facing setup notes if the extension grows.

## Build, Test, and Development Commands
- There is no build pipeline or package manager in this repository.
- Load the extension locally in Chrome via `chrome://extensions` -> `Load unpacked` -> select the repo root.
- After edits, use the extension reload button in `chrome://extensions` and refresh the Google Drive tab.
- For quick checks, inspect the Drive page manually and confirm the overlay, grid, modal, and video navigation still work.

## Coding Style & Naming Conventions
- Use plain JavaScript and CSS with ASCII-only identifiers unless a file already contains localized text.
- Follow the existing style: semicolon-terminated JavaScript, two-space indentation, and descriptive `nf-*` class names in CSS.
- Keep helper names short and intent-revealing, such as `scanFiles()`, `renderGrid()`, and `openModal()`.
- Prefer small, focused functions and avoid introducing framework-like abstractions for this lightweight content script.

## Testing Guidelines
- No automated test framework is configured.
- Validate changes manually in Google Drive with representative folders: empty folders, folders with thumbnails, and folders with video files.
- Verify key cases: overlay opens/closes, refresh rescans items, modal navigation works, and mobile layout remains usable.

## Commit & Pull Request Guidelines
- The Git history currently shows only `Initial commit`, so there is no established commit-message convention yet.
- Use short, imperative commit subjects, for example: `Add keyboard shortcut for modal navigation`.
- Pull requests should summarize the UI or behavior change, list manual verification steps, and include screenshots or screen recordings for visual updates.

## Security & Configuration Tips
- Keep `manifest.json` permissions minimal; only add new host permissions when the extension truly needs them.
- Avoid hardcoding secrets or private endpoints in `content.js` or `styles.css`.
- If you add new DOM selectors, keep them specific to Drive to reduce the chance of breaking on unrelated pages.

