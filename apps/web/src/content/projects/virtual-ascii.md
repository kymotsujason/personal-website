---
title: Virtual ASCII
summary: Your webcam as live ASCII art in any video call
kicker: Rust and video
rank: 5
date: "2026-02-13"
stats:
  - value: "15 to 19%"
    label: of one core at 720p and 30 fps, down from about 50%
  - value: "5 ms"
    label: delay at the 95th percentile, down from 17 ms
  - value: "11 ms"
    label: camera to output, down from about 116 ms
source: unreleased
hero:
  still: /projects/virtual-ascii/hero.webp
  loop: /projects/virtual-ascii/hero-loop.webp
  alt: Green glyphs on a black background in the Matrix look, shown at three levels of detail
  position: 50% 50%
thumb: /projects/virtual-ascii/thumb.webp
highlights:
  - title: Drops frames instead of falling behind
    text: Capture, render, and output run as separate stages that each keep only the newest frame. When the renderer can't keep up, the call sees fresh frames instead of a growing delay.
  - title: Decodes only what it needs
    text: The JPEG decode inside mozjpeg runs at a fraction of the frame's size, as small as 1/8, when the cells line up with the JPEG's blocks. It's used only where the result matched the full decode on 98% of cells.
  - title: Survives an unplugged camera
    text: When the camera disappears or stops responding, the app shows that it's reconnecting, keeps retrying, and keeps the virtual camera fed with a card in the meantime.
results:
  src: /projects/virtual-ascii/fig-speed.svg
  alt: Three pairs of bars comparing the app before and after the speed work, for CPU use, delay, and camera to write time
  caption: Median of 5 runs each at 720p and 30 fps in the Matrix look, measured on 2026-10-11 and 2026-10-16. The CPU figure moves from about 14.7% to 18.7% with the size of the camera's frames.
stack:
  - Rust
  - V4L2
  - mozjpeg
  - egui
status: In development
license: MIT
---

Virtual ASCII is a Rust app that turns a real webcam into ASCII art and writes it out as a virtual webcam through v4l2loopback, so it works in any call app, such as Zoom, Meet, Discord, or OBS. It comes as a command line tool and as a native window with a tray icon, and it has Matrix, Mono, and Color looks.

## How it works

Frames move through three stages. A capture stage reads the camera's JPEG frames, a render stage draws the characters, and an output stage writes them to the virtual camera, by default as YUYV with an RGB24 option for apps that can't read it. Each handoff keeps only the newest frame, so a slow stage skips ahead and the picture stays current.

Most of the work went into making that cheap. The renderer draws straight into the output's pooled frame and allocates nothing per frame, and the decoder only produces as many pixels as the look needs. Every change was measured with the same script, reader, and tool, on the same machine and camera.

<figure><img src="/projects/virtual-ascii/fig-settings-sheet.webp" alt="The settings sheet, with the camera list, quality and frame rate for the virtual camera, contrast and invert brightness for the look, and options to open at login and keep running in the tray" loading="lazy"><figcaption>The settings sheet. Quality and frame rate set what calls receive, and the look has its own controls.</figcaption></figure>

The camera's frame size moves the CPU number by several points. On one day the camera sent frames of about 240 KB and the app used 14.68% of a core, and on another they were 460 to 490 KB and it used 18.7%, with the same build. Both days stayed under the 20% of one core that was the target, so the figure is a range of about 15 to 19%.
