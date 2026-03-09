# Paisley Photography Portfolio

## Cursor Cloud specific instructions

Static Astro 5 + Tailwind CSS 4 photography portfolio. See `README.md` for full project overview and architecture.

### Services

| Service | Command | Port | Required |
|---|---|---|---|
| Astro dev server | `npm run dev` | 4321 | Yes |
| Cloudflare Worker (contact form) | `wrangler dev` from `worker/` | 8787 | No — only for testing contact form end-to-end; requires `TURNSTILE_SECRET_KEY` and `RESEND_API_KEY` secrets |

### Dev commands

Standard npm scripts — see `package.json`:
- **Dev:** `npm run dev` (runs on port 4321 with `--host`)
- **Build:** `npm run build`
- **Preview:** `npm run preview`

No dedicated lint or test scripts are configured. `npm run build` is the primary correctness check.

### Notes

- The Cloudflare Turnstile widget on `/contact` shows "Unable to connect" in local dev — this is expected since it requires a real Cloudflare site key and network access to Turnstile APIs.
- The contact form Worker (`worker/`) is deployed separately and is not needed for local site development.
