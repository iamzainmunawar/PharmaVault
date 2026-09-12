# PharmaGrid

A free, offline-capable pharmaceutical reference and drug-class explorer for Pakistan, built by a Doctor of Pharmacy student.

**Live structure at a glance:**
- **Graph** — a fixed, non-crossing map of every organ system, drug class, and subclass (2,575 generics / 45,084 brand entries under the hood), color-coded by category, rendered as pharmacy-cross badges and pill/capsule nodes.
- **Mind Map** — the same category structure as a clean radial tree, one level deep, for a simpler read.
- **Browse** — a text-based sidebar tree for people who'd rather navigate than click around a graph.
- **Reference** — 11 quick-reference tabs: medical terminology, lab values, dose calculation formulas, drug interactions, pregnancy & lactation, high-alert medications, common antidotes, renal/hepatic adjustment flags, drug suffixes/stems, drug-induced conditions, and therapeutic drug monitoring.
- **About Me / Contact Us / Disclaimer / DMCA** — standard project pages, reachable from the top nav (or the hamburger menu on mobile).

## Deploying this repo to GitHub Pages

1. Push these files to a GitHub repository (root, or a `/docs` folder — either works).
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment," set **Source** to "Deploy from a branch," pick your branch and the folder these files are in, then **Save**.
4. GitHub gives you a live URL (`https://yourusername.github.io/repo-name/`) within a minute or two.
5. Want a custom domain later? Add a `CNAME` file with your domain, point your registrar's DNS at GitHub Pages, then set the custom domain in the same Pages settings screen.

No build step, no bundler, no server — it's static files, so any static host works if you'd rather not use GitHub Pages (Netlify, Cloudflare Pages, Vercel, etc. all support the same drag-and-drop deploy).

## File structure

```
index.html          the page shell
app.css              all styling
app.js               graph / mind map / sidebar / search / drug-card logic
reference.js          Reference section tab-switching + search filter
about_contact.js      About Me / Contact Us / Disclaimer / DMCA content + nav wiring
d3.min.js             D3.js library (bundled, no CDN dependency)
vault_data.js          the full drug vault (generics, brands, classes)
reference_data.js       the 11 Reference tabs' content
```

`vault_data.js` also carries this build's fixed, zero-crossing graph layout (each node's x/y position). If the underlying vault content is ever regenerated from scratch, that layout needs to be re-baked — ask whoever built this to re-run the layout generator afterward.

## Content & accuracy

PharmaGrid is an educational reference, not a clinical decision-making tool. See the in-app Disclaimer page for the full statement — in short: verify anything here against current official prescribing information or a qualified healthcare professional before using it clinically.

## Contact

iamzainmunawar@gmail.com
