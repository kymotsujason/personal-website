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
  - value: "About 4,700"
    label: approved tracks across three games
links:
  - label: battlebgm.com
    url: https://battlebgm.com
source: private
hero:
  still: /projects/battlebgm/hero.webp
  loop: /projects/battlebgm/hero-loop.webp
  alt: A guest round of BattleBGM on the Old School RuneScape map, zooming in, locking in a guess in Asgarnia, and seeing how close it was
  position: 25% 40%
thumb: /projects/battlebgm/thumb.webp
highlights:
  - title: One writer for each lobby
    text: Every change to a lobby goes through a single writer, and its state lives in Redis, so a restarted server rebuilds the lobbies and players reconnect to them.
  - title: The answer stays on the server
    text: Scoring happens on the server, and a clip arrives with no title or source attached, so the answer never reaches the browser early.
  - title: Smoother map zoom in Firefox
    text: A first zoom into the Victoria Island map drew stepped, choppy frames in Firefox. Building the images ahead of time cut them by two thirds or more.
stack:
  - TypeScript
  - Fastify
  - PostgreSQL
  - Redis
  - WebSocket
  - Python
status: Live since September 8, 2026
---

BattleBGM is a multiplayer game where you hear a piece of music from a game you know and guess where on its map it plays. It covers Old School RuneScape, MapleStory, and World of Warcraft, and it has free play, daily and weekly rounds, custom lobbies, and ranked 1v1 matches.

## How it works

The browser plays short clips and sends a guess, and the server does everything that has to be trusted. It scores each round, hands out clips with nothing in them that names the answer, and keeps the state of every lobby. The client is written without a framework, and a QR code library is its only runtime dependency.

<figure><img src="/projects/battlebgm/fig-modes.webp" width="1200" height="750" alt="The Play page, with Free Play across the top, Daily and Weekly below it marked as needing a log in, and Score Attack" loading="lazy"><figcaption>The mode picker as a guest sees it. Daily and Weekly ask for a log in.</figcaption></figure>

Lobbies are the part that has to keep working while people come and go. A lobby has one writer, so two players acting at once can't corrupt its state, and the state sits in Redis so a restart doesn't end a game. A route fuzzer run sent 7,859 hostile requests and got no server errors back.

Behind the game is a catalog of about 4,700 approved tracks across the three games, which a Python tool prepares as short clips. The site has been live since September 8, 2026, and the source is private.
