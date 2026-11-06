---
title: MangaDex for Paperback
summary: The MangaDex source in the Paperback manga reader
kicker: iOS extension
rank: 8
date: "2025-02-22"
stats:
  - value: "4"
    label: pull requests merged
  - value: "7,500+"
    label: lines of TypeScript in the source
  - value: "6"
    label: search prefixes, such as id, ch, and author
links:
  - label: Inkdex extensions
    url: https://github.com/inkdex/general-extensions
source: public
hero:
  still: /projects/mangadex-paperback/hero.webp
  alt: The MangaDex source icon centered in a soft orange glow
  position: 50% 50%
thumb: /projects/mangadex-paperback/thumb.webp
highlights:
  - title: Tokens in the wrong slots
    text: The access and refresh tokens can arrive in swapped slots. The source reads each token's type and puts them back, instead of trusting the slot.
  - title: Sign in that handles refresh races
    text: A request refreshes a token that's about to expire once, and parallel requests share that refresh. A failed refresh pauses further attempts for 10 seconds, and a 401 gets one retry.
  - title: Search that takes a pasted ID
    text: Prefixes such as id, ch, grp, usr, author, and list jump straight to a title, chapter, group, user, author, or list, and so does a pasted MangaDex link. Title searches are ordered by relevance.
builtOn:
  name: Inkdex general extensions
  url: https://github.com/inkdex/general-extensions
results:
  src: /projects/mangadex-paperback/fig-token-refresh.svg
  alt: A flowchart of what the source does when a request finds its access token about to expire, with the clean refresh highlighted and the other outcomes below it
  caption: The refresh flow. A request checks the token's expiry, and parallel requests share one refresh.
stack:
  - TypeScript
  - The Paperback SDK
  - OAuth
status: Maintained
license: GPL 3.0 or later
---

MangaDex for Paperback is the MangaDex source in Paperback, an iOS manga reader. It lives in the [Inkdex extensions repo](https://github.com/inkdex/general-extensions), where I maintain it, and this page covers only the MangaDex source. Its work includes sign in, search, and the title and chapter handling that sits behind them.

## How it works

Paperback runs on iOS, so the extension is TypeScript against the Paperback SDK, and every request goes through one network layer. That layer checks whether the access token is within 60 seconds of expiring and refreshes it first, so a screen full of requests doesn't each try to sign in again.

<figure><img src="/projects/mangadex-paperback/fig-token-refresh.svg" alt="A flowchart of the token refresh, from a request through the expiry check to five outcomes" loading="lazy"><figcaption>Five outcomes of a refresh. Only a clean refresh, or one that lost a race to a newer refresh, lets a 401 retry.</figcaption></figure>

Four of my pull requests have been merged there. They cover letting chapters be removed, clearing the read queue, title priority with romanized titles, and a restructuring with bug fixes. The source is about 7,500 lines of TypeScript.

A related project is [Paperback2Aidoku](https://paperback2aidoku.ice55.cloud/), a tool I wrote for moving a library from Paperback to Aidoku.
