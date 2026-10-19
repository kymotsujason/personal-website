---
title: "Still working on migrating to NodeJS"
date: "2019-08-14T00:00:00.000-07:00"
slug: "still-working-on-migrating-to-nodejs"
---

So not much to say other than I'm still working on the change to NodeJS. The frontend is works fine without Django (with some tweaks) and there are a few things I also need to fix. Somehow, the fade transition never actually worked, not hard to fix but migration is higher priority. I haven't looked into the conversion between PostgreSQL and MongoDB. It should be pretty easy, since I have a small set of data to be exported. There were some limitations I encountered, due to the way I had React integrated. I'm hoping this migration will also optimize the production files so that the website loads faster. It's pretty slow in my opinion and I believe the size of the production files is the issue.
