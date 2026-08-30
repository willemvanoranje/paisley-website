# Paisley Website Contribution Guide

This project is a small Astro photography portfolio. Keep changes simple, readable, and easy for a non-programmer to maintain.

## Local development

- One-time computer setup: install the current Node.js LTS release. This provides both `npm` and `npx`; this project intentionally supports no alternate package runner. After installing Node.js, close and reopen the terminal or agent session so the new commands are visible.
- Install dependencies with `npm install`.

## Mandatory dev-testing sequence

IMPORTANT: Execute these steps in order for local testing to work. Do not skip ahead or claim the website was tested from a build alone.

1. Confirm that `node`, `npm`, and `npx` are available. If any is missing, stop and install Node.js LTS before continuing.
2. Run `npm install` from the project folder.
3. Run `npm run dev:all`. This creates the ignored local `.env` and `worker/portfolio/.dev.vars` files from their committed examples, then starts the local Cloudflare Worker and Astro website together. Do not start Astro by itself: the gallery depends on the local API at `http://localhost:8787`.
   - If it reports that port 4321 or 8787 is already in use, stop the previous preview and run this step again; do not accept a fallback port.
4. Wait until both services are ready. Confirm that `http://localhost:4321/` responds and that `http://localhost:8787/api/images` returns an image list.
5. Open `http://localhost:4321/` in the browser preview and look at the rendered website. Always visually inspect the result; a successful build is not enough.
6. Interact with the affected features in the browser. For gallery work, check the gallery, navigation, lightbox, and responsive layout when relevant. Also check `http://localhost:4321/admin` and confirm it reaches the local upload manager.
7. After making changes, repeat the relevant browser checks and run `npm run build` before completion.

The local Cloudflare Worker runs at `http://localhost:8787/` and uses local R2 storage. The local `/admin` page is the same upload manager used in production.

## Before shipping changes

- Run `npm run build`.
- Verify the affected page by looking at it and interacting with it in the browser preview.
- For gallery changes, verify the page, `/admin`, `http://localhost:8787/api/images`, and at least one lightbox interaction.
- Keep production API behavior separate from local sample data.
- Prefer small, idiomatic changes with clear names and minimal abstraction.
- Add comments only when they explain a non-obvious decision.

## Production image workflow

Production images are managed through the portfolio API admin page. Upload images at `/admin`, review alt text, visibility, and order, then save the changes. Do not put production credentials in the repository.

## Git workflow

- Use a focused branch for changes.
- Write a clear commit message.
- Open a pull request with a plain-language summary and verification notes.
- Merge only after the build and browser preview checks pass.
