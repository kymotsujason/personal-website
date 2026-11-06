---
title: jasonyue.ca
summary: A foldable phone in the browser with a screen that's real HTML
kicker: Web and 3D
rank: 4
date: "2026-10-14"
stats:
  - value: "8"
    label: weather skies behind the home screen
  - value: "0"
    label: JavaScript needed to read any page
  - value: "4"
    label: apps on the phone, each a real web page
links:
  - label: GitHub
    url: https://github.com/kymotsujason/personal-website
source: public
hero:
  still: /projects/jasonyue-ca/hero.webp
  loop: /projects/jasonyue-ca/hero-loop.webp
  alt: A pair of hands holding an open foldable phone whose screen shows the site's home screen
  position: 50% 50%
thumb: /projects/jasonyue-ca/thumb.webp
highlights:
  - title: A screen made of real pages
    text: Every page on the phone is a plain HTML page. It also reads fine with JavaScript off and with WebGL off, so nobody needs the 3D scene to read a page.
  - title: A sky that follows the visitor
    text: The wallpaper picks one of eight skies from the visitor's local weather and blends day into night with their real sunrise and sunset. The location comes from the request, so nobody sees a permission prompt.
  - title: Steps down on slow phones
    text: When a device falls behind, the page draws fewer pixels, slows the sky, and simplifies the glass in steps, and it never switches to the flat site on its own.
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

The phone is three.js and Blender work, the hands come from the CC0 MakeHuman model, the desk behind them is a photo, and the screen is the site's pages drawn onto the phone. The same pages also work on their own as a plain, flat site, and each one reads as normal HTML with no JavaScript at all.

<figure><img src="/projects/jasonyue-ca/fig-app-open.webp" width="1200" height="729" alt="The Projects app opening over the home screen on the unfolded phone, with the Super Hexagon RL card and a pickban.gg card inside its window" loading="lazy"><figcaption>The Projects app opening over the home screen, a moment after a tap on its icon.</figcaption></figure>

Speed was a requirement from the start, since a 3D scene is easy to make heavy. The page watches the frame rate and steps the scene down in stages on a slow phone. The weather sky is one program on the graphics chip for all eight skies, and a change of weather only changes its settings, so nothing has to be rebuilt.
