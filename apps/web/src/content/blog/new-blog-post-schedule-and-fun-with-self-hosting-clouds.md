---
title: "New Blog Post Schedule and Fun with Self-hosting Clouds"
date: "2019-10-01T00:00:00.000-07:00"
slug: "new-blog-post-schedule-and-fun-with-self-hosting-clouds"
feature_image: "/blog/content/images/2019/12/Annotation-2019-12-07-164703.png"
thumb: "/blog/thumbs/new-blog-post-schedule-and-fun-with-self-hosting-clouds.jpg"
---

#### New Blog Post Schedule

It has been a while since I last posted! Not because I forgot or neglected my blog. I've decided to post once per month on the first of every month instead. There just isn't that much to write every 2 weeks. Kinda skipped September, because I was initially thinking of the end of each month. However, that wouldn't give me much of a consistent day to remember.

<h4 id="self-hosted-cloud-solution-nextcloud">Self-hosted Cloud Solution - NextCloud</h4>

It's been a couple months since I've built my home server, but I haven't used it enough to justify the cost. Other than hosting game servers for my friends, I do plan to play around with some A.I. frameworks and algorithms (OpenSpiel). However, in the meantime, I decided to utilize my NAS storage to host my own file storage solution. After some research and testing out other solutions, I decided to choose NextCloud for its simplicity, openness, and performance. It took less than an hour to install NextCloud, setup Nginx, and connect my NAS storage. It's also open-source and has a robust API that'll let me build my own extensions, if I need extra functionality that is missing. Last but not least, the performance is pretty much just as good as Google Drive for my usage. I can download and upload at reasonable speeds (over 20MB/s on average) and can stream videos without lag. It's quite convenient to have a file solution that's accessible from anywhere with a storage of 20TB that can be expanded at any time. I'm currently using HDDs, but will eventually use SSDs for that extra performance.

#### Migration from Manga Rock to Tachiyomi

<p>Thought I'd mention this since I've read Manga every day. I used to use an app called Manga Rock. It was a solid app for reading manga with exceptional performance and well optimized images when using the built-in source from the Manga Rock website. However, it has recently been discontinued. While the services still works, I decided to migrate over to Tachiyomi. It was a bit of a pain to move 2400 manga and I probably should have written an automated solution (none were created at the time), but there are just too many discrepancies regarding naming, chapter count, duplicate chapters, and chapter naming. Tachiyomi is an open source manga reader with amazing performance and support for a large amount of sources. It doesn't have its own built-in source which means it doesn't quite have the same image optimization, but it makes up for it by having so many sources to choose from. Not to mention it's open source, I could just add my another source if I really need another one. Speaking of open source, I decided to fork this one so I could add my own features. The main purpose was mostly to add a fast scrollbar to the library view. It was a bit odd that it didn't have a scrollbar in the library view, but had one in chapters. Some people do have thousands of manga, actually pretty sure many people do. Anyways, here's a link to my forked repo which will only ever have what I want (planning to add a tab with info on similar manga, that'll probably be the only real feature of my fork): <a href="https://github.com/kaisrisque/tachiyomi?ref=blog.jasonyue.ca">https://github.com/kymotsujason/tachiyomi</a></p>
