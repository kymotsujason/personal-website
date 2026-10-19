---
title: "Site redesign is now live!"
date: "2019-02-28T00:00:00.000-08:00"
slug: "site-redesign-is-now-live"
feature_image: "/blog/content/images/2019/12/Annotation-2019-12-07-172252.png"
thumb: "/blog/thumbs/site-redesign-is-now-live.jpg"
---

## Successful delivery

Looks like I was able to deliver on my expectations and estimation. It took about 2 weeks to implement this new design from the ground up. While it's not completely ready (the projects page is still in development), it's at the point where I am confident it gets the point across and consider it an improvement to the previous design.

## A look into the development process

The goal of this redesign was to create a clean look with a focus on content instead of technology.

In order to get started, I researched and found quite a few designs that fit my requirements. From there, I created a quick mockup, mostly for helping me stay focused on the design and deliver the redesign within a reasonable time.

The actual development was quite easy, since the entire theme of this design is panels. I created a generic Panel component that took some props and returned the UI outfitted with the results. Currently though, I've added some static layout fixes straight into the views. I'll have to refactor the code so that the Panel handles any layout issues itself.

Unlike before, I decided to add some routing transitions. There's a noticeable fade into other pages when you attempt to navigate to another page, I believe these kinds of animations help make a page feel more fluid and faster. Though, I do need to look into the background images of the panels, because those cause a bit of lag when switching to a page that hasn't been loaded yet. Being React though, pages that were loaded will retain the images and performance is instant.

This new design certainly makes use of images a lot more than the previous, which is a good thing since pictures speak volumes. I hope visitors enjoy the images in the about section. Though the way I'm handling the images isn't ideal, I need to implement detection for images in a folder and dynamically load them in, since that'd certainly make it easier for me to add more photos and it's just better practice. The current method is just a static import, which is fine but not very robust.

The new mobile nav bar is pretty neat. I implemented a menu icon that hides the menu on mobile devices. It does bug out if you intentionally resize your browser on a desktop window and leave the menu open. I'm planning to look into a way to solve that problem, which really shouldn't be very hard, but it's not an issue I'd expect would happen to anyone really.

The new blog system actually feels like a blog now. The html link shows the title of the blog and so does the title of the tab.

The title of the page is something I forgot about previously. I noticed some of the websites I looked into had dynamic titles. I really liked that idea and decided to implement it here.

Last thing I want to talk about is the responsiveness of the site. Previously, I used window listeners for scrolling and resizing to ensure the UI elements stayed within a reasonable size. Obviously, that requires quite a lot of resources which is not ideal. This redesign only uses CSS, which I consider an improvement though I also consider this to be normal. I'd say the previous method was messy and hardcoded. One of the goals I had was to avoid using listeners on the main pages. In projects, I'd consider it a possibility if it's being used in some interesting way.

## The future

I'd like to move from static content to dynamic content. Right now, all the content and images are static and hardcoded in. Ideally, the content should be loaded dynamically from the database which will allow for very easy updates and edits. The images can either be in the database (ideally) or in some media folder and detected dynamically. Either way works for images. The framework is already there for the content, all I have to do is create and connect the tables to the frontend.

As I mentioned before, I'm currently working on implementing the projects section. I'm planning on migrating the projects from the old site to fit this new design. After that, I plan to feature some of my github software projects, though the focus will be web projects. I have quite a few ideas I'd like to implement.

My next project will be a web crawler for a game called Osu. The idea is to generate a Google Sheets compatible document with statistics from a list of links to multiplayer games. I want to generate something like a scoreboard or player ranking based on these multiplayer game links (called mp links or match links). It's not a hard thing to do, but it's something I believe will be useful.
