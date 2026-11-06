---
title: BattleBGM
summary: Guess where the game music plays
kicker: Multiplayer game
rank: 3
date: "2026-05-01"
stats:
  - value: "7,859"
    label: hostile requests, no server errors
  - value: "1"
    label: runtime dependency in the browser, a QR code library
  - value: "4,700"
    label: approved tracks across three games, about
links:
  - label: battlebgm.com
    url: https://battlebgm.com
source: private
hero:
  still: /projects/battlebgm/hero.webp
  loop: /projects/battlebgm/hero-loop.webp
  alt: The BattleBGM home page, with the headline Guess where the music plays over a field of glowing waveforms
  position: 25% 40%
thumb: /projects/battlebgm/thumb.webp
highlights:
  - title: One writer for each lobby
    text: Every change to a lobby goes through a single writer, and its state lives in Redis, so a restarted server rebuilds the lobbies and players reconnect to them.
  - title: A round can't be cheated
    text: Scoring and clip delivery both happen on the server. A clip arrives with no title or source attached, so the answer never reaches the browser early.
  - title: Smoother map zoom in Firefox
    text: A first zoom into a big map drew 41 and 24 stepped frames in Firefox. After building the images ahead of time it drew 7 and 8.
stack:
  - TypeScript
  - Fastify
  - PostgreSQL
  - Redis
  - WebSocket
  - Python
status: Live since September 8, 2026
---

BattleBGM is a multiplayer game where you hear a piece of music from a game you know and guess where on its map it plays. It covers Old School RuneScape, MapleStory, and World of Warcraft, and it has free play, daily and weekly rounds, custom lobbies, and ranked 1v1 matches rated with Glicko 2.

## How it works

The browser plays short clips and sends a guess, and the server does everything that has to be trusted. It scores each round, hands out clips with nothing in them that names the answer, and keeps the state of every lobby. The client is written without a framework, and a QR code library is its only runtime dependency.

<figure><img src="/projects/battlebgm/fig-modes.webp" alt="The Play page, with Free Play across the top, Daily and Weekly below it marked as needing a log in, and Score Attack" loading="lazy"><figcaption>The mode picker as a guest sees it. Daily and Weekly ask for a log in.</figcaption></figure>

Lobbies are the part that has to keep working while people come and go. A lobby has one writer, so two players acting at once can't corrupt its state, and the state sits in Redis so a restart doesn't end a game. A route fuzzer's recorded run sent 7,859 hostile requests and got no server errors back.

Behind the game is a catalog of about 4,700 approved tracks across the three games, which a Python tool prepares as short clips. The site has been live since September 8, 2026, and the source is private.
