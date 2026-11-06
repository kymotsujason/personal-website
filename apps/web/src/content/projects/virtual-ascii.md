---
title: Virtual ASCII
summary: Your webcam as live ASCII art, as a virtual camera that call apps on Linux can pick
kicker: Video processing
rank: 5
date: "2026-02-13"
stats:
  - value: "15 to 19%"
    label: of one core at 720p and 30 fps with the window closed, down from about 50%
  - value: "5 ms"
    label: longest app delay for 95% of frames, down from 17 ms
  - value: "11 ms"
    label: upper bound on camera to output time, down from about 116 ms
source: unreleased
hero:
  still: /projects/virtual-ascii/hero.webp
  loop: /projects/virtual-ascii/hero-loop.webp
  alt: Rows of green glyphs, a few bright and most dim, filling a black frame in the Matrix look
  position: 50% 50%
thumb: /projects/virtual-ascii/thumb.webp
highlights:
  - title: Drops frames instead of falling behind
    text: Capture, render, and output run as separate stages that each keep only the newest frame. When the renderer can't keep up, the call sees fresh frames instead of a growing delay.
  - title: Decodes only what it needs
    text: The camera sends JPEG frames, and the app decodes them at a fraction of full size, as small as 1/8, since the character grid doesn't need every pixel. It does this only for the looks and cell sizes where the result matched a full decode on 98% of cells.
  - title: Survives an unplugged camera
    text: When the camera disappears or stops responding, the app shows that it's reconnecting, keeps retrying, and keeps the virtual camera fed with a card in the meantime.
results:
  src: /projects/virtual-ascii/fig-speed.svg
  width: 960
  height: 520
  alt: Three pairs of bars for CPU use, the app's own delay, and camera to output time, with the after bar much shorter than the before bar in every pair
  caption: Median of 5 runs each at 720p and 30 fps in the Matrix look with the window closed, measured on 2026-10-11 and 2026-10-16. With the window open the CPU figure is 26.06%, and it moves from about 14.7% to 18.7% with the size of the camera's frames. The app's own delay runs from taking a frame off the camera queue to finishing its write, while camera to output time also counts the wait before that, and it's an upper bound built from two separate measurements.
stack:
  - Rust
  - V4L2
  - mozjpeg
  - egui
status: In development
license: MIT
---

Virtual ASCII is a Rust app for Linux that turns a real webcam into ASCII art and writes it out as a virtual webcam through v4l2loopback, so a call app can pick it like any other camera. It comes as a command line tool and as a native window with a tray icon, and it has Matrix, Mono, and Color looks.

## How it works

Frames move through three stages. Capture reads the camera's frames, render draws the characters, and output writes them to the virtual camera. Each stage hands over only its newest frame, so a slow stage skips ahead and the picture stays current. The output uses the YUYV video format by default, with an RGB24 option for apps that can't read it.

Most of the work went into making that cheap. The renderer draws straight into the output's pooled frame and allocates nothing per frame, and the decoder only makes as many pixels as the look needs. Every change was measured with the same script, reader, and tool, on the same machine and camera.

<figure><img src="/projects/virtual-ascii/fig-settings-sheet.webp" width="840" height="1200" alt="The settings sheet, with the camera choice, the virtual camera's quality and frame rate, the look's controls, and startup options" loading="lazy"><figcaption>The settings sheet. Quality and frame rate set what calls receive, and the look has its own controls.</figcaption></figure>

The camera's frame size moves the CPU number by several points. On one day the camera sent frames of about 240 KB and the app used 14.68% of a core, and on another they were 460 to 490 KB and it used 18.7%, with the same build. Both days stayed under the 20% of one core that was the target, so the figure is a range of about 15 to 19%.
