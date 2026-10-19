---
title: "Planning on improvements to projects"
date: "2020-02-01T00:30:00.000-08:00"
slug: "planning-on-improvements-to-projects"
---

## Website Projects

So it's been quite a long time and no progress has really been done with migrating the few projects on my website. However, I've decided to put some thought into improving how the projects are developed and displayed. Here's what I'm thinking.

Each project currently takes an extra page and is written within the main website. Due to the way the website is loaded, this shouldn't increase load times in any way. However, it does increase the complexity of the website and make it more difficult to develop complex projects. It's also quite restrictive, since I'm essentially developing under the rules of the existing website. Instead, I've decided that it's better to split projects into their own small website. If we take a chat app for example, the url would be changed from example.com/chat to chat.example.com. This already looks cleaner and there's much more freedom. Not to mention, each app could be hosted independently and won't be affected by downtime from the main website. Obviously, this is essentially how services are offered, but I never really considered it until I thought about future projects and how I'd prefer to use other frameworks or packages. If I considered these future projects as services, it makes a lot of sense to develop them in separate web apps.

## Finally using math in a project

Recently, I was given a fun project to display locations of devices on a map based off of dynamic data. This data essentially gave ranges that I'd need to use to triangulate the location of the devices. Of course, it requires pythagoras and some formulas to determine a general location where the devices can be. This is easy. The hard part is actually displaying the location, because instead of displaying the ranges from the sources and having users triangulate it themselves, I need to only render that area of the devices. This is hard, because I need to draw the shape of the location, but I only know 2 points of intersection and the calculated area. I can't be as accurate as I'd like, but I can draw a ellipse using the 2 points to make a best guess. Of course, there are lots of issues with the data such as multiple floors of data being thrown in and ranges that don't actually intersect. To deal with that, it's not too difficult if I basically flatten the data and assume 1 floor, just need to decrease the range of data from other floors. For things that don't intersect though, the best thing I can do is choose the ranges that are smallest and go from there. This is because smaller ranges mean the device is closer and I was told that the data may sometimes be inaccurate (huge ranges = not important).
