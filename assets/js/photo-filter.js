/**
 * PhotoFilter
 * ------------
 * The "white-or-transparent" candidate photo treatment, done properly:
 * a real per-pixel luminance mask rather than a blunt CSS filter.
 *
 * CSS's `filter: brightness(0) invert(1)` only respects the alpha
 * channel -- it turns every opaque pixel white regardless of how light
 * or dark it originally was, so a photo with a solid (non-transparent)
 * background just becomes a flat white rectangle. This instead reads
 * the actual pixel data on a canvas and maps each pixel's luminance to
 * an alpha value: light pixels (a bright face, a white shirt) become
 * solid/opaque white, dark pixels (shadows, dark hair, a black jacket)
 * become increasingly transparent, letting the bar's own color show
 * through underneath -- the duotone cutout look RCP/NBC use, and it
 * works the same way regardless of whether the source file has its own
 * alpha channel (png/webp/svg with transparency) or is fully opaque
 * (a plain jpg): existing alpha is respected and multiplied through,
 * not required.
 *
 * Works on any image format the <img> tag already supports --
 * png, jpg, webp, svg -- since it just rasterizes whatever the browser
 * would have shown onto a canvas first.
 */

const PhotoFilter_cache = new Map();

function PhotoFilter_process(src) {
  if (PhotoFilter_cache.has(src)) return PhotoFilter_cache.get(src);

  const promise = new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = frame.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
          // standard perceptual luminance
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
          px[i + 3] = Math.round(luminance * a);
        }
        ctx.putImageData(frame, 0, 0);
        resolve(canvas.toDataURL());
      } catch (e) {
        // e.g. blocked by CORS if ever pointed at a cross-origin photo -- fall back to original
        resolve(src);
      }
    };
    image.onerror = () => resolve(src);
    image.src = src;
  });

  PhotoFilter_cache.set(src, promise);
  return promise;
}

/**
 * Processes every <img> matching `selector` (default: .white-filter-img)
 * in place, swapping its src for the luminance-masked version once ready.
 */
function PhotoFilter_applyAll(selector = '.white-filter-img') {
  document.querySelectorAll(selector).forEach(img => {
    const original = img.getAttribute('data-original-src') || img.getAttribute('src');
    img.setAttribute('data-original-src', original);
    PhotoFilter_process(original).then(dataUrl => { img.src = dataUrl; });
  });
}

if (typeof window !== 'undefined') {
  window.PhotoFilter_process = PhotoFilter_process;
  window.PhotoFilter_applyAll = PhotoFilter_applyAll;
}
