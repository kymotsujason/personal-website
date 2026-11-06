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
    label: ways a token refresh can end, each handled on its own
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
  - title: Sign in that handles refresh races
    text: Several requests can find the token expiring at once, so it's refreshed a single time and the parallel requests share that refresh. If the API still turns a request down with a 401, the request is retried once, and only after a refresh that saved new tokens or found a parallel refresh had already saved newer ones.
  - title: Search that takes a pasted ID
    text: Prefixes such as id, ch, grp, usr, author, and list jump straight to a title, chapter, group, user, author, or list, and so does a pasted MangaDex link. Title searches are ordered by relevance.
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

<figure><img src="/projects/mangadex-paperback/fig-token-refresh.svg" width="960" height="590" alt="A flowchart showing that an expiring token is refreshed once and shared, and that the refresh ends in one of five outcomes, only two of which allow a retry after a 401" loading="lazy"><figcaption>The five outcomes of a refresh. A 401 retries once, and only after a refresh that saved new tokens or found a parallel refresh had already saved newer ones.</figcaption></figure>

Four of my pull requests have been merged there. They cover letting chapters be removed, clearing the read queue, title priority with romanized titles, and a restructuring with bug fixes.

A related project is [Paperback2Aidoku](https://paperback2aidoku.ice55.cloud/), a tool I wrote for moving a library from Paperback to Aidoku.
