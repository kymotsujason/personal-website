# Jason Yue's personal website

This is the source for my personal site. It's an interactive three.js scene of my desk with a blog and project pages, built with Astro and served from Cloudflare Workers. A small Worker also serves `/api/home`, which feeds the weather and GitHub bits of the scene.

## Running it

```bash
pnpm install
pnpm -C apps/web dev
```

Run `pnpm -C apps/web test` for the unit tests and `pnpm -C apps/web test:browser` for the Playwright tests.

The browser tests need Playwright's Chromium and Firefox (`pnpm -C apps/web exec playwright install chromium firefox`). Firefox runs only the checks for bugs it alone shows. The browser tests run on the GPU, and `PW_GPU=0` runs them on SwiftShader instead. The compare fixtures are tied to the GPU and driver of the machine that recorded them.

## Licenses

The code, the dev tools, the baked keys, and `hands-rig.json` are under the MIT license (see `LICENSE`).

All rights are reserved for the packed models, the desk images, the Ice avatar, the link preview image, the photos, the blog posts, and the page text.

Some assets have their own terms. The hand model comes from MakeHuman and is CC0. The forest wallpaper was bought. The phone is modeled on Apple's iPhone Duo, which is Apple's design.
