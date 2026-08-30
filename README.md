# Paisley — Photography Portfolio

A clean, minimal photography portfolio website built with Astro and Tailwind CSS.

## Pages

- **Portfolio** (`/`) — Masonry-style photo gallery with lightbox viewer.
- **About** (`/about`) — Bio, experience timeline, skills grid, and education
- **Contact** (`/contact`) — Contact form with Cloudflare Turnstile verification

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | [Astro 5](https://astro.build) | Zero JS by default, perfect for content-heavy static sites |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) | Utility-first CSS, rapid responsive design |
| Fonts | Google Fonts (Inter + Montserrat) | Inter for body text, Montserrat for display/nav |
| Images | Unsplash (placeholder) | Swap with real photos later |
| Interactivity | Vanilla JS | Lightbox, mobile menu — no framework overhead |

## Project Structure

```
src/
├── layouts/
│   └── Layout.astro           # Base HTML shell, meta tags, font loading
├── components/
│   ├── Header.astro           # Logo + nav + mobile hamburger menu
│   ├── Footer.astro           # Copyright + social links
│   ├── GalleryGrid.astro      # Masonry photo grid (CSS columns)
│   └── Lightbox.astro         # Full-screen image viewer with keyboard nav
└── pages/
    ├── index.astro            # Portfolio page
    ├── about.astro            # About page
    └── contact.astro          # Contact form page

worker/
├── index.js                   # Cloudflare Worker for Turnstile verification
└── wrangler.toml              # Worker deployment config
```

## Getting Started

### Prerequisites

- Node.js 22+ (install via [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`)

### Install and Run

```bash
npm install
npm run dev
```

The site will be available at `http://localhost:4321/`.

To start both the site and the local Cloudflare Worker/R2 emulator with one command, use:

```bash
npm run dev:all
```

The combined command seeds the local R2 store with the sample images on its first run. To run only the local Worker in a separate terminal, use:

```bash
npm run dev:worker
```

The local Worker serves the same `/api/images`, `/images/...`, and `/admin` routes as production at `http://localhost:8787/`. Its local R2 data persists in `.wrangler/portfolio/` and is ignored by Git. The local `.env` file points the site at this Worker; `.env.example` documents that setting without committing it.

When the local site is running, opening `http://localhost:4321/admin` hands off automatically to the local Worker manager at `http://localhost:8787/admin`.

Wrangler is run with a pinned version and downloaded automatically by `npx` the first time. Local-only credentials live in `worker/portfolio/.dev.vars`, which is ignored by Git and can be created from `worker/portfolio/.dev.vars.example` if needed.

### Production image workflow

Images are managed by the portfolio API and stored in the Cloudflare R2 bucket configured in `worker/portfolio/wrangler.toml`:

1. Open `/admin` on the production site. It redirects to the portfolio manager.
2. Sign in with the `ADMIN_PASSWORD` configured as a Worker secret.
3. Upload JPG, PNG, WebP, AVIF, or GIF files.
4. Edit alt text, visibility, and ordering, then choose **Save Changes**.
5. The public gallery reads the updated manifest from `GET /api/images` and serves files from `/images/<filename>`.

The frontend deployment must have `PUBLIC_PORTFOLIO_API_URL` set to the deployed portfolio API URL. The API Worker is deployed separately from the Astro site.

### Build for Production

```bash
npm run build
npm run preview
```

## Accessing from Your Phone

The dev server is configured with `--host` to bind to all network interfaces. Since the dev environment runs on WSL2 (which has its own virtual network), use Cloudflare Tunnel to expose it:

```bash
# Install cloudflared (one-time)
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
chmod +x /tmp/cloudflared

# Start a tunnel (while dev server is running)
/tmp/cloudflared tunnel --url http://localhost:4321
```

This prints a public URL (e.g., `https://random-words.trycloudflare.com`) you can open on any device. No account required.

**Note:** The Vite dev server blocks unknown hostnames by default. The `allowedHosts` config in `astro.config.mjs` whitelists `.trycloudflare.com` domains for this purpose.

## Architecture Decisions

### Why Astro over Next.js

This site is 95% static content with minimal interactivity (lightbox + mobile menu). Astro ships zero JavaScript by default and only hydrates what you explicitly opt into. Next.js would bundle the entire React runtime on every page — unnecessary weight for a portfolio site.

### CSS Masonry over JS Libraries

The gallery uses CSS `column-count` for the masonry layout rather than a JavaScript library like Masonry.js. This is simpler, has zero runtime cost, and handles the varying image aspect ratios well. The column count adjusts via media queries: 2 columns on mobile, 3 on tablet, 4 on desktop.

### Mobile Menu Outside Header

The mobile menu overlay is rendered as a sibling element outside the `<header>`, not nested inside it. This avoids a CSS stacking context issue: the sticky header creates its own stacking context (via `z-index`), which prevents child elements from rendering above content in `<main>`, even with `position: fixed`. Moving the overlay outside the header ensures it covers the full viewport with a solid white background.

### Inline Styles for Mobile Menu Background

The mobile menu uses an inline `style="background:#ffffff"` rather than Tailwind's `bg-white` class. During development, Tailwind CSS v4's utility classes weren't reliably rendering the background on the fixed overlay, causing gallery images to bleed through the menu. The inline style guarantees a solid opaque background regardless of CSS specificity or class generation order.

### Contact Form Spam Protection

The contact form uses [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) — a privacy-friendly, invisible CAPTCHA alternative. The flow:

1. Turnstile generates a cryptographic token when the user interacts with the page
2. On form submit, the token is sent (along with form data) to a Cloudflare Worker
3. The Worker verifies the token server-side against Cloudflare's SiteVerify API
4. Only verified submissions are accepted

The Worker source lives in `worker/`. See [docs/cloudflare-turnstile-plan.md](docs/cloudflare-turnstile-plan.md) for the full architecture plan and deployment steps.

### Tunnel-Friendly Vite Config

WSL2 runs on a virtual network that isn't directly reachable from other devices. To test on a phone, we use Cloudflare's quick tunnel (`cloudflared tunnel --url`), which proxies through a `*.trycloudflare.com` domain. Vite's `server.allowedHosts` is configured to accept these hostnames, otherwise the dev server returns a "blocked request" error.

## Planned Work

- [x] Cloudflare Turnstile + Worker for contact form verification ([plan](docs/cloudflare-turnstile-plan.md))
- [x] Email delivery for contact form submissions (via [Resend](https://resend.com))
- [x] Custom domain registration and setup (`paisleys.work`)
- [x] Custom email address (`hello@paisleys.work` via Cloudflare Email Routing)
- [x] Deployment to production (Cloudflare Pages)
- [ ] Replace placeholder images with real photography
