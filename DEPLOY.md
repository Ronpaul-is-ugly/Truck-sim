# Website and hosting

The public site is a static build: a landing page at `/` and the simulator at `/simulator`.
It is set up for **Cloudflare Pages** (free tier, unlimited bandwidth, automatic HTTPS).

```bash
npm run build:site    # type-check + build into dist/
npx vite preview --config vite.site.config.ts   # look at it locally
```

| Output | Source |
| --- | --- |
| `dist/index.html` | `site/home.html` (landing page, `site/home.css`, `site/home.ts`, `site/img/`) |
| `dist/simulator.html` | `index.html` (the simulator, unchanged; the build adds a "Home" link) |
| `dist/_headers`, `_redirects`, `404.html`, `robots.txt`, `favicon.svg` | `public/` |

`npm run dev` and `npm run build` are unchanged and still open the simulator directly.

## Connect Cloudflare Pages (one time)

1. Sign up at dash.cloudflare.com (free).
2. **Workers & Pages → Create → Pages → Connect to Git**, authorize GitHub, pick `truck-sim`.
3. Build settings:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: `npm run build:site`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `20` (also pinned in `.nvmrc`)
4. **Save and Deploy.** The site goes live at `<project>.pages.dev`. Every push to `main` redeploys,
   and every pull request gets its own preview URL.

## Custom domain

1. Buy the domain (Cloudflare Registrar sells at cost, or use any registrar).
2. In the Pages project: **Custom domains → Set up a custom domain**, enter it, and follow the DNS step
   (automatic if the domain is on Cloudflare).

## After the domain exists

- The contact address is `CONTACT_EMAIL` in `site/home.ts` (waitlist and school pilot buttons) and the footer of `site/home.html`.
- "Tek Simulator" is a working name, used in `site/home.html`, `site/home.ts` and `public/404.html`.
