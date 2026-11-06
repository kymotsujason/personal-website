---
title: Super Hexagon RL
summary: An agent that plays every level of the real game live
kicker: Reinforcement learning
rank: 1
date: "2026-10-19"
stats:
  - value: "120/120"
    label: real game runs last the full 10 minutes
  - value: "1.86M"
    label: simulator steps a second
  - value: "15 hours"
    label: of play without a death
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
    text: The game's own logic, compiled from its decompiled code, matched the real game on every check, including the whole 247 KB game object, over about 69 minutes of play.
  - title: A bug found by replay
    text: Live runs were dying early because the game dropped held keys when a window changed focus. Replaying live games in the simulator found it, and the fix took a stress test from 0 of 20 runs surviving to 19 of 20.
results:
  src: /projects/super-hexagon-rl/fig-tradeoff.svg
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

Super Hexagon RL is a self learning agent that plays every level of Terry Cavanagh's Super Hexagon, the real game running on Linux, with real key presses. It isn't affiliated with Terry Cavanagh and doesn't include the game or its code. It exists because I wanted to see whether a small policy could survive a game that most people lose in seconds, and whether I could make it fast to train without ever changing the game itself. The result survives the full 10 minutes in all 120 of its real game runs, and it plays all six levels live in a 7 minute video that isn't edited.

## How it works

The game runs in fixed 1/60 second steps, so training doesn't need to draw anything. A small library loaded in front of the game takes over its clock, its random numbers, and the Steam calls, then pauses the game after every decision until the agent answers. The game binary is never patched, and the launcher checks its hash before it starts.

Real game steps are still slow, so the agent trains against a simulator instead. I decompiled the game's logic in Ghidra and turned it into C, which a script compares against the real game at every decision. With 256 simulators on 8 threads it runs 1.86 million agent steps a second, and the policy is trained with PPO.

<figure><img src="/projects/super-hexagon-rl/fig-live-grid.webp" alt="Six Super Hexagon windows open side by side, each in a different level and colors, all being played at once" loading="lazy"><figcaption>Six games played live at once, one window per level.</figcaption></figure>

Playing live is a different problem from training, since the game runs on its own clock and the agent has to keep up. It reads the game's memory, sends keys straight to the game's window, and checks that its keys land on the very next tick. 31,774 of 31,777 key changes did.

The best survival score and the smoothest play pull in different directions. One model taps about six times a second and never dies in 120 real game runs. The one I'd call best holds keys the way a person would, at 1.19 presses a second with a 340 ms average hold, and still reaches the cap in 116 of 120.
