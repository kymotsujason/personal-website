---
title: jasonyue.ca
summary: A foldable phone in the browser with a screen that's real HTML
kicker: Web and 3D
rank: 4
date: "2026-10-14"
stats:
  - value: "60 fps"
    label: on an iPhone Air while opening apps
  - value: "8"
    label: weather skies behind the home screen
  - value: "550+"
    label: tests
links:
  - label: GitHub
    url: https://github.com/kymotsujason/personal-website
source: public
hero:
  still: /projects/jasonyue-ca/hero.webp
  loop: /projects/jasonyue-ca/hero-loop.webp
  alt: A pair of hands holding an open foldable phone whose screen shows the site's home screen, with a profile card, a GitHub activity grid, a music player, and app icons
  position: 50% 50%
thumb: /projects/jasonyue-ca/thumb.webp
highlights:
  - title: A screen made of real pages
    text: Every page on the phone is an ordinary HTML page that also reads fine with JavaScript off and with WebGL off, so the 3D scene adds to the site and never gates it.
  - title: A sky that follows the visitor
    text: The wallpaper picks one of eight skies from the visitor's local weather and blends day into night with their real sunrise and sunset. The location comes from the request, so nobody sees a permission prompt.
  - title: Measured on a real phone
    text: Frame rates were logged on an iPhone Air in Safari, and in the runs I kept no second of play fell under 30 frames a second.
stack:
  - Astro
  - Three.js
  - JavaScript
  - GLSL
  - Blender
  - Cloudflare Workers
status: Live
license: MIT
---

jasonyue.ca is this site. Hands take an iPhone Duo out, unfold it, and hold it up, and its screen is the site itself, so the Projects, Blog, About, and Music apps you use are real web pages running inside a 3D scene.

## How it works

The phone, the hands, and the desk behind them are three.js and Blender work, and the screen is the site's pages drawn onto the phone. The same pages also work on their own as a plain, flat site, and each one reads as normal HTML with no JavaScript at all.

<figure><img src="/projects/jasonyue-ca/hero.webp" alt="The open phone held in two hands, with the home screen showing a profile card, a latest project tile, a GitHub activity grid, a music player, and icons for About, Projects, Blog, and Music" loading="lazy"><figcaption>The home screen on the unfolded phone, with the weather sky behind it.</figcaption></figure>

Speed was a requirement from the start, since a 3D scene is easy to make heavy. I logged frames on an iPhone Air in Safari while opening apps and scrolling, and the runs I kept averaged 58 to 66 frames a second with no second under 30. The weather sky is one shader for all eight scenes, picked by uniforms, so a change of weather doesn't compile anything.
