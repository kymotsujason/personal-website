---
title: "Optimization and projects online!"
date: "2019-03-14T00:00:00.000-07:00"
slug: "optimization-and-projects-online"
feature_image: "/blog/content/images/2019/12/Annotation-2019-12-07-172343.png"
thumb: "/blog/thumbs/optimization-and-projects-online.jpg"
---

## Optimization

### Code-splitting

Now that I have the website working for the most part, I decided to begin looking into optimization in the form of reducing the size of the files that are being requested by the clients. One method involves code-splitting.

The way this method is executed is through dynamic imports. This means that instead of having a component or view imported at the top of the file, we create a constant that holds an anonymous function, which is the import statement. As a result, the import is only called when the constant gets called. This works very well when used with routing, since only certain pages will be loaded at a time, saving some bandwidth. I used a package called react-loadable to handle the imports and also include a loading screen for when a page is being loaded.

I initially had issues with implementing dynamic imports. An error would popup saying that the import statement inside the constant was unexpected. After searching for information on the error and modifying Webpack/Babel, I found out that it was actually ESLint causing that error. The reason why the error happened was because ESLint was configured for React, but not Babel. This meant that any syntax or feature enabled by Babel would get flagged by ESLint, because ESLint wouldn't recognize it. If only I realized sooner, I'd have saved hours of wasted time... Well anyways, it's all working now so moving on.

<h3 id="image-optimization-minification">Image Optimization &amp; Minification</h3>

#### Image size optimization

I decided to test the efficiency of my website by using free mobile testing resources and found out that images seem to take up a quite a lot of resources on mobile devices. A physical test, using my mobile, showed that the images do take a while to load even with a fast connection.

To mitigate this, I decided to resize the images to 3 width sizes of 768px, 992px, and 1440px. This means that there are now 4 images that can be served to the various forms of devices. There are 2 ways these images are being rendered which are as a background and as a img. With the background, I decided to take the easy route and create separate css classnames under the @media tags. This would allow me to change the image based on the width of the device. As for the img render, I decided to use the package react-responsive-img to handle the rendering and utilize the source tag, which allows me to define the appropriate image to be used depending on the width of the device being used. Since the about page uses a image gallery, it had to be adapted to use the source tag so that the proper images are being used for the appropriate device.

#### Image Minification

Using multiple image sizes helps a lot for optimizing load times on mobile. However, the actual file sizes of the images are still pretty large. To fix this, I used an online resource that automatically minified the images. From what I understand, minifying an image means to reduce the color depth and quality of parts of the image without visibly altering the image. This would massively decrease the file size, while maintaining quality as far as the eye can see. I basically batch uploaded all the images I used and had them all minified to reduce the file size.

## Web projects migration

Finally, all of the pre-existing web projects from the old theme has been migrated to the new theme. One of the new additions for this is the description for the project and process of making it, which I believe to be more important than the actual project.

For some projects, not much really had to be changed other than the surrounding class names and tags (Game of Life). Others went through a bit of a rework, such as the Tic-tac-toe. I decided that the original button method was not good enough and decided to use the stylized buttons over the plain old blue ones. Perhaps some images might make it even better, but I'll need to add image handling to my stylizedbutton component. There are only 2 options now, which are singleplayer and multiplayer. The AI option was integrated with the single player mode and is accessible with a flick of a switch. There's also an issue with the multiplayer, which is somehow being rendered twice and causing an error to show up. There shouldn't be a memory leak due to the way it is handled, but the error shows anyways. I'll find a way to fix it though. The chat project was just changed a little bit for the styling. It was based on Facebook messenger before, but I decided to change it to a more uniform and consistent layout.
