---
title: "Rebuilding the backend"
date: "2019-07-14T00:00:00.000-07:00"
slug: "rebuilding-the-backend"
feature_image: "/blog/content/images/2019/12/Annotation-2019-12-07-165359.png"
thumb: "/blog/thumbs/rebuilding-the-backend.jpg"
---

So Django has been pretty good so far. While the integration method I used is limited in some ways, it's mostly functional and does everything that I need right now. However, I've been using NodeJS and ReactJS extensively at work and I've really enjoyed the full JavaScript stack experience.

Not to mention that I've started to understand NodeJS better. Obviously, setting up a RESTful API is very easy and I've done it plenty of times (I still remember forgetting to add body-parser for JSON parsing). I've also learned how to set up an email listener with email parsing (which I'm pretty confident in). Since authentication is a thing, I've learned how to access LDAP servers and a bit about SAML authentication. It's not much, but I certainly have enjoyed this more than the usual IT things.

Now, on to the main point of this page. I've invested more time into NodeJS than Django at this point and I don't really have a reason to keep using Django. Previously, I was thinking of using Python for better integration with Python applications. However, I've realized that I could just run a Python server and have it communicate with the NodeJS server. Migrating to NodeJS will be a bit difficult, since I'll need to convert the PostgreSQL database to MongoDB (gotta get that MERN). I also need to look into NodeJS sockets to migrate the realtime chat app, as well as the multiplayer Tic-Tac-Toe. Now that I think about it, I also need to get to adding in the software section. Anyways, I'm going to start rebuilding the backend with NodeJS and use Express to serve the ReactJS and NodeJS files. There's this neat NPM package called Project Manager 2, which can run Express in the background. I'll be using this extensively for serving the production builds.
