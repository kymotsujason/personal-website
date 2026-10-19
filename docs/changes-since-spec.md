# Changes since the spec

This file lists each place the build differs from the design spec (`2026-10-17-real-site-design.md`) and why. A place where the build only follows the spec isn't listed. Each section below is one difference, except the known gaps at the end, which give each gap its own paragraph.

## The metadata reader is repo code

The spec says the metadata reader is a pinned pnpm dependency. The build reads image metadata with its own code in `tools/privacy/metadata.mjs`, which has no dependency to pin. It gives the same result the spec wanted, since it's the same in a fresh clone, in Workers Builds, and in the Action, and a reader that is missing or crashes still fails the check.

## The privacy check flags some things the spec doesn't list

The spec's check refuses an image carrying EXIF, XMP, or IPTC data, and the build does that for every format it reads (see the known gaps below for the ones it refuses unread). It also flags PNG text chunks and `tIME`, and any JPEG segment, PNG chunk, or AVIF box and item property that isn't on a list of known harmless ones, so a file that was stripped always scans clean and anything unfamiliar is refused until it's added to the list.

Images are also recognized by their first bytes on every file, not only by extension. `.heif` and `.hif` join the deny list next to `.heic`, and `.svg` files are checked for embedded `data:image`, `<metadata`, XMP packets, editor path attributes, entity declarations, and any link or quoted value that starts with a local path instead of being refused outright, since the scaffold ships `favicon.svg`. The path check can't tell a path on Jason's machine from a path on the site, so an SVG that links to a site path such as `/about` is refused as well, and the fix is a relative or full URL.

Inline images are refused outright in every text file the hooks check, in every SVG, and in the JS, CSS, and HTML in `dist`, since images ship from `public/` as committed and an image pasted into a source file is as public as one in `public/`. The check doesn't read an inline image's payload. A file is refused when it holds a `data:` URI whose type is an image or names SVG, or a base64 or percent escaped run whose first bytes are an image the check knows or SVG markup, whatever header sits in front of it (see the known gaps below for how). Raw `<svg>` markup in a markup or component file (`.astro`, `.html`, `.jsx`, `.tsx`, `.md`, `.mdx`, `.svelte`, or `.vue`) gets the same SVG rules an `.svg` file gets, with two differences. A site path such as `/about` or `/icons.svg#arrow` is normal in a page's own markup, so there the two path rules refuse only a path shaped like one on a machine (a drive letter, `file:`, `~/`, a backslash, or a root folder that holds files, which is `/home/`, `/Users/`, `/root/`, `/mnt/`, `/media/`, `/Volumes/`, `/tmp/`, `/var/`, `/private/`, or `/opt/`). An `<svg>` with no matching `</svg>` is most often one named in prose or a comment, so it gets every rule except those two. The reader finds where each tag ends by skipping quoted values and `{...}` expressions, so a `>` in a JSX or Astro expression doesn't end it. The build sets Vite's `assetsInlineLimit` to 0, so it never inlines an asset on its own.

## Scaffold images were stripped late

The scaffold's shadcn PNGs in `.agents/skills/shadcn/assets/` carried EXIF and XMP, so they were stripped in a later commit. The unstripped copies are in the local history from before the first push. The first push is meant to be one clean root commit made from the current tree, as the spec's clean-folder rule says, so they won't reach the public repo.

## The `desk-wall-mask-small.png` strip

The spec says every image goes through the metadata strip. The spike's `desk-wall-mask-small.png` was the only copied image that reported anything (ImageMagick `tIME` and `tEXt` date chunks), so it was stripped with `stripMetadata`. A test in `assets.test.js` checks that its image data (the IDAT bytes) is the same as the original's, so the strip changed nothing the picture shows. The other copied images were scanned clean and ship as the spike's bytes without going through the strip.

## The comparison tolerance

The spec says the hand bone matrices and the phone's transform match the spike's "within a small tolerance". The build sets it to 1e-4 per matrix entry, and screenshots may differ in under 0.5% of pixels (any channel more than 16 levels off). The tolerance was meant to be 10 times the largest difference between two recordings of the spike, with 1e-4 as the floor. The recordings matched exactly after rounding to 6 significant digits, so the floor applies. That rounding allows up to 5e-5 of error in an entry, which is under the 1e-4 tolerance.

The fixtures hold more than the bones. Each frame also has the fold, hinge, body, and pivot matrices, and the roll group's effect is covered through them. The fixtures are stored gzipped (`.json.gz`) to keep the public repo smaller.

## The reference spike moved past `b4769a4`

The site was ported from the spike at `b4769a4`. When Jason tested that commit on 2026-10-19 (Task 16), it was merged in the workshop with `abb08c1`, which makes the intro wait until the page fades in from black instead of starting when the models load. The full and the fast intro both start at the fade now, and only the fast unfold's timing and easing changed, since it eases out of closed with some speed. That change is ported into `src/scene/intro.js`, `loop.js`, `device.js`, and `tween.js` (`outSine`). The site also places the phone at the intro's start when a resize rebuilds it while the page is still black, and the intro then opens the address's app, since the site plays the intro on an app's address too. The workshop's `83541ed` (the music card titled Music) is ported too. The same test found the desk drawn wrong in Firefox, since its WebGL uploaded each cropped strip of the full desk photo from the top of the whole photo, so the photo worker now draws each strip into its own canvas, with a Firefox test (`tests/firefox/photo-strips.spec.ts`). The workshop's `master` at `83541ed` is the reference spike from here on, and the compare's fast intro fixtures were recorded again from it.

## Compare screenshots are tied to one machine

The compare screenshots are now GPU renders, taken from the spike with Chromium on ANGLE over the desktop OpenGL driver (an RTX 3080 on driver 615.78). Of the 32, the 26 outside the fast intro come from `b4769a4`, and the six fast intro ones from `83541ed` (see `tests/fixtures/poses/README.md`). SwiftShader renders failed 4 of the 10 sequences at 1.1% to 5.9% of pixels against the 0.5% limit, while the matrices came out identical on both. The 0.5% limit didn't change.

As a result the screenshots depend on this machine's GPU and driver. A driver update or another machine needs a new recording, or `PW_GPU=0` with SwiftShader fixtures recorded the same way. `PW_GPU=0` puts the compare, the other browser tests, and `tools/compare/record.mjs` back on SwiftShader.

## The compare runs only when asked for

The spec doesn't say when the comparison runs. It has its own Playwright project, `compare`, which `pnpm verify` and a plain `playwright test` skip. Run it with `PW_PROJECT=compare pnpm -C apps/web exec playwright test --project compare` for the dev server, and with `COMPARE_CAPTURE=1` in front for the capture build. It takes about a minute each on the GPU.

## The capture build has extra controls

The spec describes the capture build as the production build plus a read only pose readout. The build's `window.__capture` also has the controls the compare needs to drive the same sequences the dev page does, which are `act`, `setDevice`, and `screens`, plus `throwNextFrame` for the failure tests. It's never deployed, since only the `prod` and compare projects build with `CAPTURE=1`, into `dist-capture`.

The spec lists `?slow` and `?noweather` as dev only. They work in the capture build as well as in dev (`src/scene/switches.js`), since the compare needs them there. The build that ships ignores both, and a ship test loads it with `?slow=50` and checks that `dist` has no `noweather`.

## The watchdog counts only visible time

The spec starts a 10 second watchdog from the head script. The build pauses it while `document.hidden` is true, since a tab opened in the background doesn't run animation frames and would otherwise fall to the flat site before anyone saw it. A scene that hangs in a hidden tab stays black until the tab is shown, then falls back after 10 visible seconds.

## The Worker's cache key host

The spec doesn't name the key the Worker's weather cache uses. The build keys `caches.default` by `https://jasonyue.ca/__cache/weather/<LAT_CELL>/<LON_CELL>`, the site's own host, since Cloudflare's docs don't settle whether a key on a host outside the zone is stored. The key is only a label and no request is ever made to it. Whether the Cache API keeps entries under it can only be seen on a deploy.

## Music can load on the flat music page

The music code lives in the layout script, as the spec says. The spec has the player load on the first tap. The flat `/music` page is the exception, since it loads the player after the page's `load` event without a tap, the way the 3D Music app does when it opens, so the player shows in its slot. A script added before that event would hold the load until YouTube answered. On every other page the player still loads on the first tap or click.

## The intro flag is written early

The spec writes `introSeen` once the intro finishes. The build writes it when the intro unlocks the phone, which is before the unfold tween ends. That's the moment the visitor can use the page, and writing it later missed first visits that ended in an app.

## The compare page has the spike's icons

The compare page is fed the spike's 8 icons instead of the site's 4, since the comparison is about the hands and phone, and with 4 icons About grows from another spot, which fails screenshots for a reason outside what's compared. The matrices match either way. As a result the 4 icon open origin isn't screenshot compared, and the navigation tests cover it.

## Smart punctuation is off for Markdown

Astro 7's Markdown processor turns straight quotes, `--`, and `...` into curly quotes, dashes, and ellipses. That would change the wording of the imported posts, so `astro.config.mjs` turns smart punctuation off for all Markdown, which also covers the About and project pages. This needs `@astrojs/markdown-satteri` as a direct dependency.

## The 404 page has no canonical link

The spec says every page's canonical link uses `https://jasonyue.ca`. The 404 page has no canonical link or `og:url`, since its address isn't known at build time, and it carries `noindex` so a search engine doesn't keep it. It isn't in the sitemap either.

## The html-rules check reads one search narrowly

The spec says a check on the built HTML enforces that CSS never ships in a lazy chunk. The task's plain string search for `createElement("link")` matches Astro, Vite, and React runtime code in every build, so `tools/html-rules.mjs` flags `createElement("style")`, a stylesheet `rel` set on a created link, and a `.css` file named inside a chunk. A lazy chunk that adds CSS some other way wouldn't be flagged.

## Scripts before the first frame are over the estimate

The spec aims at about 200 to 220 kB gzipped of JavaScript before the first frame, and calls that an estimate Jason may not reach. The build is at 229.7 kB, measured with `tools/size-report.mjs`, down from 234.6 kB before the slimming steps. Most of the rest is three.js (66.9 kB) and the scene chunk with the renderer and loaders (151.9 kB). The dev tools were already out of the production build, so removing them saved nothing.

## The head script adds the preloads

The spec preloads the models and the small desk images from the head, and adds the key and rig files. The head script adds those `<link rel="preload">` elements itself, and only when it sets `has-3d`, so a visitor who gets the flat site or has no JavaScript doesn't download the models, the keys, the rig, or the wall mask, which the flat site never uses. The links carry the same `as` and `crossorigin` the loaders' requests do, so each file still comes down once. The first client side navigation drops them from the head, since they aren't in the next page's HTML, and by then the scene has usually asked for each file itself.

## The not found page is flat in 3D

The scene has no app for the not found page, so with 3D it would hide the page under the home screen. The head script leaves `has-3d` off on that page, so it shows as the flat site, and a navigation to it from a 3D page is a full page load. Its own links are full page loads too, so a visitor with 3D gets the scene back on the next page, and its 3D version link goes to `/`.

## A failed scene chunk doesn't always reload

The spec loads the page again once when a lazy chunk fails to load. The layout skips that reload for the scene chunk when the page already shows flat (the watchdog gave up first), when the arrival showed the page first, and when the browser reports it's offline, since in each case the visitor is already reading the page and a reload would take it away or land on the browser's offline page. The page shows flat instead. The reload stays for the case it's for, a deploy that landed between the HTML and the chunk.

## The flat site has a sky, not a desk

The spec's Flat site section puts the column over a blurred desk. The app pages design pass on 2026-10-18 put the home screen's sky behind every app, so the flat site shows that sky across the whole window instead, and the page reads the same in 3D and flat. The sky is a layer inside `#page` (a gradient, sun and moon glows, tiled stars, and a dim), drawn from the visitor's clock in the flat site. `body::before` and its desk photo are gone from `flat.css`, and `desk-small.jpg` stays for the scene. The column is transparent over the sky.

## The app pages carry a still copy of the sky

The home screen's sky is a shader, and the app pages can't run it behind a plain HTML page. They carry a still CSS copy of it instead, built by `src/lib/sky.js`. In 3D the scene sets its variables from the weather and the time it already knows, and in the flat site the layout sets them from the clock. The copy has no moving clouds and no rain, so it matches the shader's colors at that moment but not its motion. A unit test checks `sky.js` against the shader's numbers for clear night, clear day, dusk, overcast, and fog.

## Known gaps against the spec

The privacy check now reads the containers it used to pass unscanned. An ICO's PNG images go through the PNG scan (and the strip), and its BMP images are accepted only when they hold a 40 byte header, the palette, the pixels, and the mask with nothing else, since that header has no text fields. A gzipped SVG (`.svgz`, or any gzip file holding SVG) must be a single gzip stream with no file name, comment, extra field, modification time, or bytes after it, and the SVG inside gets the SVG rules and the inline image check. SVG in UTF-16 is decoded, and an SVG root after a long prolog is still found. A gzip file that holds text is unpacked, and the text gets the inline image check. AVIF item properties and data references are checked against a harmless list.

The inline image check reads a text file the way a browser might before it reads a URL. It undoes HTML character references, JS string escapes, CSS escapes, and percent escapes in every order up to three deep (so JS that writes HTML, or an HTML attribute holding CSS, is covered), and drops tabs and newlines (a scheme that starts a new line still counts). In each of those readings it looks for `data:` followed by a type of `image` with a subtype, or any type naming SVG, and then the comma that starts the payload, with only header characters between. A parameter may hold a quoted value. A backtick, a quote outside a parameter value, a paren, or a colon ends the header, so code such as three.js's check of whether a URI starts with the scheme and `image/` isn't refused. It then decodes the first bytes at each start in a base64 run (base64url too, with percent escapes and whitespace inside it allowed), where a run starts again after whitespace and after `=`, and at the start of each run holding a percent escape. The file is refused when those bytes are an image the check knows by its magic bytes, or the start of SVG markup (an XML declaration, a comment, a DOCTYPE, or an `<svg>` root after a BOM and up to 1 KB of whitespace and NULs). A gzip run and a bare JPEG XL codestream are ignored, since a browser doesn't unpack gzip in a URL and that codestream's two byte magic turns up in ordinary paths, and a run that starts like an ICO only counts when its directory holds together.

Since the payload isn't read, a header alone is enough. A URI built at run time from a literal header and a variable is refused, and so is a doc or code comment that writes a whole image header with its comma, even with a placeholder after it. The fix is building the scheme from pieces, the way the privacy tests and `compare.spec.ts` do. JPEG 2000, PSD, the raw formats (ORF, RW2, RAF), RIFF media such as AVI and WAV, Matroska such as WebM, a gzip file wrapping any other image, TIFF, BMP, JPEG XL, and ISO BMFF video are refused instead of parsed, since the site doesn't ship any of them. An SVG in an encoding the check doesn't decode (such as UTF-32) is refused too. PDF and ZIP files are refused by their first bytes as well (Jason's choice on 2026-10-19), along with the formats built on ZIP such as DOCX and JAR, since a PDF keeps its author and often a path on the machine and a ZIP can carry any file unread. A gzipped PDF or ZIP is refused the same way. The check only looks at the start, so a PDF with bytes before its header or a ZIP with data in front of its first entry (a self extracting archive, say) passes unless it's named `.pdf`, `.zip`, or another name the check maps to them, and an encoded one inside a text file isn't looked for. Other archives and documents that can carry files or an author (7z, RAR, tar, and the older Office files such as `.doc` and `.xls`) aren't recognized and pass as ordinary files.

However, a few things still pass without a scan. A file the check doesn't recognize as an image or one of the formats above isn't opened, so it passes as an ordinary file. Raw `<svg>` markup in a JS, TS, MJS, or CSS file, or in a JS string, doesn't get the SVG rules, since code mentions `<svg>` in comments and strings far more often than it pastes an export. Each top level `<svg>` in a markup file is read up to its matching `</svg>`, or to the end of the file when it isn't closed, and an unclosed one gets every rule but the two path rules. An MP3 with cover art passes as well, and so does an image stored as raw binary after a gzip stream. Outside a `data:` URI with an image type, an encoded image is found only when a run starts at its first byte, so base64 sitting partway into a longer run isn't found, and a raw payload with no percent escape in its first run isn't read. SVG markup after more than 1 KB of encoded whitespace isn't found either. Escapes nested more than three layers deep aren't undone. A header parameter holding an unquoted paren, backtick, quote, or colon ends the header for the check, although a browser may read on, so that URI is found only through its payload. As a result a few crafted cases pass and are parked as known gaps. They are an image written out as code instead of an encoding (a C byte array, a JS string of `\x` escapes, or a `Uint8Array` literal), percent escaped SVG after a URL's `#` fragment, a paren in a header parameter in front of a raw SVG payload, base64 glued onto an identifier such as `name_`, and SVG markup in a `.js`, `.ts`, `.mjs`, or `.css` file.

A music chunk that fails to load doesn't trigger the full page load the spec has for a failed lazy chunk. `src/layout/player.js` drops the queued calls and asks again on the next gesture, without using `recoverFromChunk`, so a stale tab after a deploy has no music until a reload. The volume buttons' and the charging cable's chunks don't trigger it either. One that fails is logged and isn't asked for again in that page load, so the phone goes on without its volume buttons or its cable.
