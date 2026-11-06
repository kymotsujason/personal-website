---
title: Mouse Battery
summary: A Logitech mouse's battery in the Linux tray, with a health window
kicker: Linux desktop
rank: 7
date: "2026-09-28"
stats:
  - value: "9"
    label: releases between September 28 and October 17
  - value: "1,683"
    label: tests
  - value: "42"
    label: charges until it judges battery health
links:
  - label: GitHub
    url: https://github.com/kymotsujason/logitech-mouse-battery-tray-icon
  - label: Latest release
    url: https://github.com/kymotsujason/logitech-mouse-battery-tray-icon/releases/latest
source: public
hero:
  still: /projects/mouse-battery/hero.webp
  alt: The Mouse Battery window on its Level tab, with a mouse picture filled to 64%, a battery health box, and a list of two mice
  position: 35% 20%
thumb: /projects/mouse-battery/thumb.webp
highlights:
  - title: Reads mice the kernel leaves alone
    text: The PRO X3 SUPERSTRIKE's receiver and cable are among the devices the kernel doesn't drive, so Mouse Battery speaks Logitech's HID++ protocol to them itself, and reads the rest through UPower.
  - title: One sandboxed service opens the receiver
    text: Only the battery service touches the receiver, running as its own system user in a systemd sandbox. The udev rule hands over an interface only when its report descriptor passes the app's own check.
  - title: A health judgment, with honest limits
    text: After about 42 charges it compares how the battery drains and charges with when tracking began, and warns at 15% worse. Until then it says it's still learning, and it says so when a mouse reports too little.
stack:
  - Python
  - PyQt6
  - HID++
  - D-Bus
  - systemd
  - SQLite
status: Released, v1.2.4 on October 17, 2026
license: GPL 3.0 or later
---

Mouse Battery shows the battery level of a Logitech mouse in the Linux system tray, with a battery window that tracks how the battery holds up over time. It warns at 10% and again at 5%, and with more than one mouse it follows the one in use. It isn't affiliated with Logitech.

## How it works

A small service reads the mice and saves each one's history in a SQLite database. The tray app and the battery window ask it over the system bus, and it's the only program the package lets open the receiver or cable. The service limits how often it reads, with five reads at once for each account and then one every 30 seconds.

<figure><img src="/projects/mouse-battery/fig-window-hours.webp" alt="The battery window on its Hours per Charge tab, with a line chart of about 40 hours per charge from March to October and a health box saying the battery is doing as well as when tracking began" loading="lazy"><figcaption>The Hours per Charge tab, with the health box, charge cycles, and charging speed.</figcaption></figure>

Packages come for Debian, Fedora, and Arch, and each file in a release after 1.1.0 carries a signed record of how it was built, which `gh attestation verify` checks. The README lists the mice it has been tested with, and the known limits sit beside them.
