---
title: "New equipment to keep things interesting"
date: "2020-01-01T17:56:51.000-08:00"
slug: "new-equipment-to-keep-things-interesting"
feature_image: "/blog/content/images/2020/01/20191206_200441-1.jpg"
thumb: "/blog/thumbs/new-equipment-to-keep-things-interesting.jpg"
---

## Nebia Spa Shower

Recently, I've decided to change things up and get a new shower head. The reason for that is because I like to take a shower every day. It just doesn't feel right to not take a shower. Since I use the shower so often, I think it's fair to improve the equipment used for that small quality of life tweak.

After taking a look around the different types of shower heads, I chose the Nebia Spa Shower, because it looked interesting. The concept behind the engineering makes sense to me and sounds like a lot of fun. Having a ton of water particles raining down on you would make for an interesting feeling that I haven't had before.

I bought it during Black Friday (luckily they had a sale) and it arrived really quickly (3 days). Unfortunately, I wasn't able to install it on the same day, due to the original shower head being really stuck and I didn't have the tools to get it out (a regular wrench doesn't have enough grip, neither do I). I decided to buy a vice grip and jack wrench from Amazon, which arrived the next day somehow. Only needed the jack wrench, which had an amazingly powerful grip. Anyways, installation was super easy and fast. Only problem is that the plumbing made the Nebia slightly not flush with the wall, which isn't a problem for me.

After waiting 24 hours, I got to try out the shower and it was quite an experience. Coming from a shower head that pushed out a few powerful jets, Nebia essentially sprayed a mist with enough force to clean out soap/shampoo, yet still felt as gentle as a cloud (if that makes sense). I'd waver between calling it a mist and a storm. Getting closer to the bottom of the tub, I could feel a lot of wind which just shows how much force Nebia is generating. Overall, quite a worthwhile purchase.

MIDI keyboard

So I recently decided to purchase a MIDI keyboard to make some music in Cubase. I've taken 2 classes in music composition back in University, but never really put it to use. I figured it's time to start learning again, not to mention making music for my own software, such as games or Visual Novels (some day). I bought the Kompact Kontrol M32, since it was small and budget friendly. It was surprisingly easy to get it hooked up to Cubase. Now all I have to do is start using it.

## Year end work event

As the new year comes closer, I was told that my team would have a year end event to close out the year. We had a larger budget compared to the quarter end events, meaning we could do more than just a fancy dinner. We decided on playing Archery tag and eating at this all you can eat Japanese sushi and Korean BBQ place. Let's talk about Archery tag.

### Archery tag

Archery tag is actually not quite tag, but rather an assortment of games with the dodgeball element. The twist was that we played on sand and used bows and arrows to hit each other. This was an interesting, since we could do some nifty dodging on sand without worrying about injuries, and using bows and arrows is something I've never done before.

We put on this mask to protect our face and some people decided to use these arm bands to protect from the bow string feedback, which were pretty cool but wasn't necessary since there was a pretty easy technique to not get hit by the bow string. I only hit myself with the bow string once, when I wasn't careful. Actually nocking the arrow and shooting was a bit tricky. You had to pull it back enough that it would fly straight and far, but also make sure you aren't pointing the arrow up or it'd just get lobbed over the opponents. I shot above the opponents a lot, since I kept forgetting to ensure the arrow was flat on the bow. I did get some pretty good hits in though and got better as we went on. It was a fun experience.

### Dinner

There isn't really much to say about the dinner. It was great and I ordered a ton of cones, since I really liked them. I never saw so many cones on a plate before, because they're usually around $4-5. We also ate a lot of BBQ chicken, pork, and beef. I also decided to try a bit of the beer that the others ordered. They ordered a ton of beer, since it was a bit of a celebration (probably?). Surprisingly good quality, especially since I don't usually drink beer. I might try beer more, it was an Asahi craft beer, low in Alcohol so could drink a lot without getting drunk.

## Trouble in Ghost town

So recently I decided to start updating my Linux servers and existing software running various websites. Everything went smoothly, I updated all Ubuntu servers to use the latest packages and updated NextCloud from 16-17 without much trouble and added more apps. However, I did encounter some trouble with my personal blog.

The blog system used is Ghost CMS. It does a great job in serving blog content and provides many features that I find useful. However, I had been on Ghost v2 and Ghost-Cli v1.11.0, which were both outdated as the newest Ghost v3 had come out and Ghost-Cli should have been on v1.13.0. This is where the problems started occurring. For some reason, I could not get Ghost-Cli to update. Since I couldn't get it to update, I couldn't get Ghost to update from 2-3 either. It was an odd issue, I could update using NPM without a problem and I can see that the 1.13.0 package was installed. However, I'd still see Ghost-Cli on v1.11.0 even after restarting both ghost and the entire system. Fortunately, I found a solution which was to delete the binary and reinstall v1.13.0.

<p>While this worked and I was able to update Ghost CMS from v2-v3, this also caused Ghost to be unable to start. Ghost had used that binary to start the Systemd process, which was a bit of an issue. After going through some solutions, I noticed that my personal website (<a href="https://jasonyue.ca/?ref=blog.jasonyue.ca">https://jasonyue.ca/</a>) was also affected as pm2 was now missing from the global NPM packages. Even after re-configuring the setup and looking around, I wasn't able to find a good solution. I decided to start up a new VM and do the entire installation process again, but noticed that the binary didn't exist on this new installation and the Systemd startup file was completely different. This gave me the idea to delete the Systemd service from the original VM and recreate it, and it worked, of course. However, I wasn't able to access the website anymore, even though there was no error log or any indication that the server was unavailable. This turned out to be a configuration issue. I had listed the website internal IP as 127.0.0.1, which usually wouldn't work since it'd make it invisible, however, Ghost somehow worked like this instead of using 0.0.0.0. So I rolled with it, until now when it didn't work. After switching to 0.0.0.0, it worked again. </p>

Not sure what kind of change they did to have this functionality change, but it works now.

## Blog comments are active

It took quite a long time from when this blog was first created to now, but I've finally added comments! Rather than creating a discussion system, I decided to just go with Disqus, as it's a pre-built solution that is used in many news sites and works quite well. Feel free to drop a comment, if you feel like it. I'll likely reply if it's something I can reply to.

## **In-website PDF reader**

I was recently given the task to display PDFs on my links portal website to offer faster and better assistance. What made this task unique was that the PDF should be displayed within the website and not offloaded to the browser. The idea behind this is so that the user doesn't need to download a PDF and open it manually. I think this would improve the quality of the website navigation, since the user would be able to load PDFs right from the website.

My idea would be to create something similar to a search engine and render the PDF on the same page in a popup, or be redirected to the renderer through a static link. The only issue is that I had trouble finding a PDF renderer that would do exactly what I wanted. Instead of rendering a PDF, the solution I went with was to convert the PDF to HTML and serve the HTML in an iframe. This works perfectly using a program called pdf2htmlEX. I would have a directory monitoring service that would activate a bash script if a file is added. This bash script would replace any spaces in the file name with underscores (\_) and convert the PDF into HTML. Once converted, I can add this file's existence to MongoDB so the NodeJS backend is aware of it. The search engine would pick up on the file name and be able to display the new file to users. I had decided using a database over having NodeJS scan the directory, since it would offer better persistence.

The search engine itself is a virtualized list, which I believe is a better solution to using different pages. The user can scroll endlessly through thousands of entries without suffering from performance impacts, since it's all virtualized.
