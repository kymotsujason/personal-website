---
title: Tobii Gaze for Linux
summary: Eye tracking on Linux with a gaze ring that only stream viewers see
kicker: Linux and hardware
rank: 6
date: "2026-07-26"
stats:
  - value: "33 Hz"
    label: what the tracker really sends, sold as 133 Hz
  - value: "13"
    label: patches to the driver
  - value: "21 of 2,000"
    label: replies went to the wrong client before the routing fix
source: unreleased
hero:
  still: /projects/tobii-gaze-linux/hero.webp
  alt: The Tobii Gaze window, with a setup checklist, a picker for which screen the tracker sits under, and a preview of the gaze ring with opacity, color, and timing controls
  position: 50% 0%
thumb: /projects/tobii-gaze-linux/thumb.webp
highlights:
  - title: Measured, not trusted
    text: Tobii sells the tracker as 133 Hz, and the driver's notes give a 232 byte sample. Neither held up. A sample is 392 bytes, and the tracker ships every fourth frame, which makes 33 Hz. The code follows what was measured.
  - title: A calibration overflow, fixed
    text: A 512 byte buffer overflowed on any calibration blob past roughly 478 bytes. The patch enlarges the buffers and bounds every blob against the 4096 byte limit.
  - title: Recovers from unplugging
    text: An unplug is detected instead of looking like an idle device, and the daemon reopens the tracker with a growing wait. It also starts when the tracker isn't there yet.
builtOn:
  name: tobiifree
  url: https://github.com/Aetherall/tobiifree
links:
  - label: tobiifree
    url: https://github.com/Aetherall/tobiifree
stack:
  - C
  - C++
  - Qt 6
  - KDE Frameworks
  - libobs
  - Zig
status: In development
license: GPL 3.0
---

Tobii Gaze for Linux draws where a player is looking into an OBS stream, with an overlay that exists only inside OBS, so the player never sees it. It builds on [tobiifree](https://github.com/Aetherall/tobiifree) by Aetherall, which did the USB reverse engineering that makes the tracker usable on Linux at all. My work sits on top of it, in the driver patches, the calibration tool, a tray app, and the OBS filter.

## How it works

The tracker's driver runs as a daemon that clients talk to over a socket. A calibration tool maps the tracker's output to the screen, the tray app turns gaze on and off and sets up the ring, and a filter plugin in OBS draws the ring on the capture of the tracked screen. The ring's constants are shared between the app and the filter, so the two always draw the same thing.

<figure><img src="/projects/tobii-gaze-linux/hero.webp" alt="The Tobii Gaze window showing a five step setup list, a screen picker with the monitors laid out, and a preview of the ring" loading="lazy"><figcaption>The setup window, with the tracker found, the screen picker, and the ring preview.</figcaption></figure>

Thirteen patches change the driver. They make the daemon route each reply to the client that asked, keep one owner of the USB link, queue writes for slow readers, report the tracker's status, and report to systemd when it's ready. The README names the patch series as the notice GPL asks for.

Calibration turned out to depend on where you sit. A day old fit left three of four calibration dots 107 to 166 px off target, and a refit to that run's own points fixed it. So the calibration tool now prints the seat distance beside the fit, which lets a stale fit be spotted before it's mistaken for an edge problem.
