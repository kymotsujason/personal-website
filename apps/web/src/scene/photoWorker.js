// decodes a full desk photo off the page's thread and cuts it into strips of rows, each its own bitmap, for
// backdrop.js to upload one a frame. on an iphone the page's own decode of the 4096 by 3143 photo held a frame for about
// 190 ms with almost none of the page's script, and each strip read out of the whole bitmap took about 20 ms to upload,
// in proportion to the bitmap's height, not the strip's
self.onmessage = async ({ data }) => {
    const { id, url, options, rows } = data;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            self.postMessage({ id, error: `${res.status} for ${url}` });
            return;
        }
        const bitmap = await createImageBitmap(await res.blob(), options);
        const { width, height } = bitmap;
        const strips = [];
        // each strip is drawn into its own canvas, since firefox's webgl uploads a bitmap cut with createImageBitmap's
        // crop from the top of the whole photo, so every strip showed the photo's first rows. a worker without
        // OffscreenCanvas throws here, and backdrop.js then cuts the strips out of a bitmap on the page
        for (let y = 0; y < height; y += rows) {
            const canvas = new OffscreenCanvas(width, Math.min(rows, height - y));
            canvas.getContext("2d").drawImage(bitmap, 0, y, width, canvas.height, 0, 0, width, canvas.height);
            strips.push(canvas.transferToImageBitmap());
        }
        bitmap.close();
        self.postMessage({ id, width, height, strips }, strips);
    } catch (error) {
        self.postMessage({ id, error: String(error) });
    }
};
