# Paisley Website Contribution Guide

This project is a small Astro photography portfolio. Keep changes simple, readable, and easy for a non-programmer to maintain.

## Local development

- Install dependencies with `npm install`.
- Start the website and sample-image API together with `npm run dev:all`.
- Open `http://localhost:4321/` in the browser preview.
- The local Cloudflare Worker runs at `http://localhost:8787/` and uses local R2 storage.
- The local `/admin` page is the same upload manager used in production.

## Before shipping changes

- Run `npm run build`.
- Verify the affected page in the browser preview.
- For gallery changes, verify the page, `/admin`, and `http://localhost:8787/api/images`.
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
