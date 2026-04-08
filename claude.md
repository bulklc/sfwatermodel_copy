# Agent Notes

## Workflow Rules

- **Do NOT run `vite build` or any build command to check work after each change.** The user will test in the browser. Only build if explicitly asked.

## Content Maintenance

- **Help Modal (`src/components/HelpModal.jsx`):** The help modal content describes how the app works — inputs, assumptions, model engine, map display, and element popups. **Update the modal text every time app functionality changes** (e.g. new layers, new popup fields, new valve types, changed model inputs, new UI controls, etc.).
