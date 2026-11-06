---
title: pickban.gg
summary: Match prep for osu! tournaments, with a win probability for every map
kicker: Machine learning
rank: 2
date: "2026-03-29"
stats:
  - value: "0.882"
    label: AUC predicting who wins a game
  - value: "1,795"
    label: backend tests
  - value: "2.7M"
    label: player scores behind the ratings
links:
  - label: pickban.gg (invite only)
    url: https://pickban.gg
source: private
hero:
  still: /projects/pickban-gg/hero.webp
  alt: The Head-to-Head page comparing two top osu! players, with a ring showing a 56 percent matchup, their ratings, and radar and trend charts below
  position: 50% 30%
thumb: /projects/pickban-gg/thumb.webp
highlights:
  - title: Calibrated probabilities
    text: A CatBoost model tuned with Optuna predicts each game, and isotonic calibration keeps its percentages honest. Every map gets a win probability with a 95% interval.
  - title: Profiled before it was sped up
    text: Profiling a full prediction showed the model took a small share of the time and feature assembly took 96 to 99 percent of each map. The work went where the time was.
  - title: Picks and bans as a game
    text: A Nash solver scores every lineup against every counter, so the advice comes from the worst case a lineup can face and not from a hopeful guess.
stack:
  - Python
  - FastAPI
  - CatBoost
  - PostgreSQL
  - Redis
  - Next.js
  - TypeScript
status: Closed beta
---

pickban.gg is match preparation for osu! tournaments. A team pastes in its mappool, loads its opponent's roster, and gets a win probability for each map, a ranking of the maps that decide the match, and advice on what to pick and ban. It exists to give a team a measured view of a match before it plays it, from a model trained on about 96,000 tournament matches.

## How it works

Every prediction starts from player and map data in PostgreSQL, about 2.7 million player scores in all. A ported tournament rating engine supplies the ratings, and a CatBoost model turns two lineups and a map into the chance that each side wins it. The deployed model scores an AUC of 0.882, and each map carries a 95% interval so a close call looks like one.

<figure><img src="/projects/pickban-gg/fig-login.webp" alt="The pickban.gg sign in page, with the name, a short description, a notice that the site is invite only in closed beta, and a button to authorize with osu!" loading="lazy"><figcaption>The sign in page. The site is invite only while it's in closed beta.</figcaption></figure>

On top of the predictions sit the tools a team uses in the lobby. A live simulator lets a coach drag maps into pick, ban, and protect zones and watch the probabilities move as games finish, and Head-to-Head compares two players on patterns, form, and every game they've played against each other. Every prediction is saved, so an analysis can be forked, rerun against the current model, or shared as a read only link.

The Nash solver treats a lineup choice as a game. For a team of four picked from eight players, it builds a table of every lineup against every counter and scores each by the worst result it can face. A backend of 1,795 tests keeps the data rules, such as which games count and how winners are decided, from drifting between training and serving.
