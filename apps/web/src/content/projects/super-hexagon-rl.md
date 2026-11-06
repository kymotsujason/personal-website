---
title: Super Hexagon RL
summary: An agent that plays every level of the real game live
kicker: Reinforcement learning
rank: 1
date: "2026-10-19"
stats:
  - value: "120/120"
    label: real runs survived 10 minutes, paused per decision
  - value: "1.86M"
    label: simulator steps a second
  - value: "15 hours"
    label: of play without a death, in 30 runs of 30 minutes
links:
  - label: GitHub
    url: https://github.com/kymotsujason/super-hexagon-rl
  - label: Watch it play
    url: https://youtu.be/_lxDK-jy9rA
source: public
hero:
  still: /projects/super-hexagon-rl/hero.webp
  loop: /projects/super-hexagon-rl/hero-loop.webp
  alt: The agent steering through the walls of a Super Hexagon level
  position: 50% 50%
thumb: /projects/super-hexagon-rl/thumb.webp
highlights:
  - title: The game stays untouched
    text: A preloaded library takes over the game's clock and input, so training runs the real game one step at a time without patching its binary.
  - title: A simulator that matched the game
    text: The game's own logic, compiled from its decompiled code, matched the real game on every check over about 69 minutes of play. That includes the 247 KB game object, apart from the colors, music and sound data, clock readings, and the pointers the simulator replaces.
  - title: A bug found by replay
    text: Live runs were dying early because the game dropped held keys when a window changed focus. Replaying live games in the simulator found it, and the fix took a stress test from 0 of 20 runs surviving to 19 of 20.
results:
  src: /projects/super-hexagon-rl/fig-tradeoff.svg
  width: 960
  height: 560
  alt: A chart of seven models, with the share of runs reaching 600 seconds against key presses a second, where smoother play gives up a few runs
  caption: Seven models on 360 seeded simulator runs each. The model that holds keys like a person, at 1.19 presses a second, reaches the cap in 349 of 360 runs.
stack:
  - Python
  - PyTorch
  - C
  - Ghidra
  - SDL2
  - X11
status: Done
license: MIT
---

Super Hexagon RL is a self learning agent for Terry Cavanagh's Super Hexagon, the real game running on Linux. With the real game paused after each decision until the agent answers, it survives the full 10 minutes in all 120 of its runs. It also plays all six levels live, on the game's own clock with key presses sent to the game's window, in a 7 minute video that isn't edited. It isn't affiliated with Terry Cavanagh and doesn't include the game or its code.

## How it works

The game runs in fixed 1/60 second steps, so training doesn't need to draw anything. A small library loaded in front of the game takes over its clock, its random numbers, and the Steam calls, then pauses the game after every decision until the agent answers. The game binary is never patched, and the launcher checks its hash before it starts.

Real game steps are still slow, so the agent trains against a simulator instead. I decompiled the game's logic in Ghidra and turned it into C, which a script compares against the real game at every decision. With 256 simulators on 8 threads it runs 1.86 million agent steps a second. The agent learns by playing, using a standard method called PPO that nudges its choices towards what scored well.

<figure><img src="/projects/super-hexagon-rl/fig-live-grid.webp" width="1200" height="619" alt="Six Super Hexagon windows open side by side, each in a different level and colors, all being played at once" loading="lazy"><figcaption>Six games played live at once, one window per level.</figcaption></figure>

Playing live is a different problem from training, since the game runs on its own clock and the agent has to keep up. It reads the game's memory, sends keys straight to the game's window, and checks that its keys land on the very next tick. 31,774 of 31,777 key changes did.

How much survival does smoother play cost? The model that taps about six times a second never dies in 120 runs of the real game, with the game paused at each decision. The one I'd call best holds keys the way a person would, at 1.19 presses a second with a 340 ms average hold. It reaches the cap in 116 of 120 runs, so smoother play costs four runs.
