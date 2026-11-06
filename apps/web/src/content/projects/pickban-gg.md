---
title: pickban.gg
summary: Match prep for osu! tournaments, with a win probability for every map
kicker: Machine learning
rank: 2
date: "2026-03-29"
stats:
  - value: "0.875"
    label: AUC on 144,234 held out games
  - value: "4,900"
    label: lineup matchups scored when picking four of eight
  - value: "2.7M"
    label: player scores in the training data
links:
  - label: pickban.gg (invite only)
    url: https://pickban.gg
source: private
hero:
  still: /projects/pickban-gg/hero.webp
  alt: The Head-to-Head page comparing two top osu! players, with a ring showing a 56 percent matchup, their ratings, and radar and trend charts below
  position: 50% 30%
thumb: /projects/pickban-gg/thumb.webp
builtOn:
  name: o!TR (osu! Tournament Rating)
  url: https://github.com/osu-tournament-rating/otr-processor
highlights:
  - title: Calibrated probabilities
    text: A CatBoost model tuned with Optuna predicts each game, and isotonic calibration makes sure that when it says 70 percent, that side wins about 70 percent of the time. Every map gets a win probability with a 95% interval.
  - title: Profiled before it was sped up
    text: Profiling a full prediction showed the model took a small share of the time and feature assembly took 96 to 99 percent of each map. The work went where the time was.
  - title: Picks and bans as a game
    text: A lineup optimizer ranks every lineup by the worst result it can face against any counter, so the advice comes from the worst case and not from a hopeful guess.
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

pickban.gg is match preparation for osu! tournaments. A team pastes in its mappool and loads its opponent's roster. It gets a win probability for each map, a ranking of the maps that decide the match, and advice on what to pick and ban. The model is trained on about 96,000 tournament matches from the weekly database dump of o!TR, the osu! Tournament Rating project. The ratings behind it are computed locally with o!TR's own rating processor, run on that dump.

## How it works

Every prediction starts from player and map data in PostgreSQL, which holds about 2.7 million player scores in the training data. The o!TR dump supplies the games and o!TR's processor turns them into ratings. A CatBoost model then turns two lineups and a map into the chance that each side wins it. On 144,234 games held out from training, the tuned model scores an AUC of 0.875. AUC is a score for how well a model tells winners from losers, where 0.5 is a coin flip and 1 is perfect. Each map carries a 95% interval so a close call looks like one.

<figure><img src="/projects/pickban-gg/fig-login.webp" width="1200" height="750" alt="The pickban.gg sign in page, with the name, a short description, a notice that the site is invite only in closed beta, and a button to authorize with osu!" loading="lazy"><figcaption>The sign in page. The site is invite only while it's in closed beta.</figcaption></figure>

On top of the predictions sit the tools a team uses in the lobby. A live simulator lets a coach drag maps into pick, ban, and protect zones and watch the probabilities move as games finish. Head-to-Head compares two players on patterns, form, and every game they've played against each other. Every prediction is saved, so an analysis can be forked, rerun against the current model, or shared as a read only link.

The lineup optimizer treats a lineup choice as a game. For a team of four picked from eight players, it builds a table of every lineup against every counter and ranks each lineup by the worst result it can face.
