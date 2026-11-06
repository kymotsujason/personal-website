---
title: MangaDex for Paperback
summary: MangaDex sign in, search, and chapters inside the Paperback reader on iOS
kicker: iOS extension
rank: 8
date: "2025-02-22"
stats:
  - value: "4"
    label: pull requests merged
  - value: "5"
    label: sign in refresh outcomes
  - value: "6"
    label: search prefixes, such as id, ch, and author
links:
  - label: Inkdex extensions
    url: https://github.com/inkdex/general-extensions
source: public
hero:
  still: /projects/mangadex-paperback/hero.webp
  alt: The MangaDex extension icon centered in a soft orange glow
  position: 50% 50%
thumb: /projects/mangadex-paperback/thumb.webp
highlights:
  - title: Tokens in the wrong slots
    text: The access and refresh tokens can arrive in swapped slots. The extension reads each token's type and puts them back, instead of trusting the slot.
  - title: Requests share one refresh
    text: Several requests can find the sign in token about to expire at once. One refresh runs and they share it. If the API rejects a request with a 401, the extension tries a refresh and retries the request once. It retries only when that refresh saved new tokens or found that a parallel refresh already had.
  - title: Search that takes a pasted ID
    text: Prefixes such as id, ch, grp, usr, author, and list take a MangaDex ID, and a pasted MangaDex link works too. The search then finds the title, the title a chapter belongs to, or the titles from a group, author, user, or list. Choosing Best Match ranks title results by relevance.
builtOn:
  name: Inkdex general extensions
  url: https://github.com/inkdex/general-extensions
stack:
  - TypeScript
  - The Paperback SDK
  - OAuth
status: Maintained
license: GPL 3.0 or later
---

MangaDex for Paperback is an extension that lets Paperback, an iOS manga reader, sign in to MangaDex, search it, and open its titles and chapters. It lives in the [Inkdex extensions repo](https://github.com/inkdex/general-extensions), where I maintain it, and builds on the Inkdex project's own MangaDex code.

## How it works

The extension is TypeScript against the Paperback SDK, and every request goes through one network layer. That layer checks whether the access token is within 60 seconds of expiring and refreshes it first, so a screen full of requests doesn't each try to sign in again.

<figure><img src="/projects/mangadex-paperback/fig-token-refresh.svg" width="960" height="590" alt="A flowchart showing that an expiring token is refreshed once and shared, and that the refresh ends in one of five outcomes, only two of which allow a retry after a 401" loading="lazy"><figcaption>The five outcomes of a refresh. Refreshed sends the request with the new token, and Already done sends it with the newer tokens a parallel refresh saved. The other three send it without a token, and a rejected sign in also clears the session while a failed refresh logs an error. After a 401, a request is retried once, and only when the refresh saved new tokens or found that a parallel refresh already had.</figcaption></figure>

Four of my pull requests have been merged there. They cover letting chapters be removed, clearing the read queue, title priority with romanized titles, and a restructuring with bug fixes.

A related project is [Paperback2Aidoku](https://paperback2aidoku.ice55.cloud/), a tool I wrote for moving a library from Paperback to Aidoku.
