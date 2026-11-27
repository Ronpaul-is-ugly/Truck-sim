// Build for the public website (Cloudflare Pages).
//
//   npm run build:site   ->  dist/index.html       landing page (site/home.html)
//                            dist/simulator.html   the simulator (index.html)
//
// The plain `npm run dev` / `npm run build` are unchanged and still open the simulator at /.
import { defineConfig } from 'vite';
import { renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = __dirname;
const out = resolve(root, 'dist');

export default defineConfig({
  base: '/',
  build: {
    outDir: out,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        simulator: resolve(root, 'index.html'),
        home: resolve(root, 'site/home.html'),
      },
    },
  },
  plugins: [
    {
      name: 'site-layout',
      // Give the simulator a way back to the website without touching index.html.
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.filename.endsWith('/index.html') || ctx.filename.includes('/site/')) return html;
          return html.replace(
            '<body>',
            '<body>\n<a href="/" style="position:fixed;top:10px;right:14px;z-index:50;font:600 11px/1 \'Titillium Web\',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a8a93;text-decoration:none;border:1px solid #33333b;padding:7px 10px;background:#0a0a0c">&larr; Home</a>',
          );
        },
      },
      // The landing page becomes / and the simulator becomes /simulator.
      closeBundle() {
        renameSync(resolve(out, 'index.html'), resolve(out, 'simulator.html'));
        renameSync(resolve(out, 'site/home.html'), resolve(out, 'index.html'));
        rmSync(resolve(out, 'site'), { recursive: true, force: true });
      },
    },
  ],
});
