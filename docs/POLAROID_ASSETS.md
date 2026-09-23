# Polaroid background asset

- **Asset:** `public/polaroid-clouds.png` (served at `/polaroid-clouds.png`).
- **Created:** 2026-09-23.
- **Method:** one call to the built-in `image_gen.imagegen` tool in generation mode, without reference images. No CLI/API fallback.
- **Model provenance:** the built-in tool does not expose a selectable or reported model version. No specific image-model version is asserted.
- **Actual output:** 1122 × 1402 pixels, PNG, 1,629,001 bytes. This is approximately 4:5; the requested size was 1200 × 1500, with 1024 × 1280 offered as an alternative.
- **SHA-256:** `3f9a63303e92624a89b7f01a2687ad20dc8ab8db12eaa6b979b80183df6e4537`.
- **Original generated file:** `C:/Users/seabo/.codex/generated_images/01a0cca0-7ced-7743-a77c-7e8c4b880bf6/exec-66829ae1-580e-44be-9c2f-6646a508c062.png`.
- **Processing:** copied unchanged into the project. No resizing, cropping, retouching, compositing, or new logo creation.

## Intended use and inspection

A background layer for the Polaroid maker's `clouds` frame. The renderer places the guest's opaque square photo over the upper central region, then adds the existing wedding monogram and editable text separately. The artwork contains no text, logo, monogram, people, or photographs.

Visual inspection confirmed warm ivory paper, pale blue-gray cloud washes with restrained gold edges, a small illustrated paper plane at the upper right, and white jasmine at the lower right. The central field and center of the footer are quiet and suitable for overlays. Some upper-corner decoration extends into the requested photo reservation; the intended opaque photo overlay covers that area. Keep footer text centered and clear of the outer floral and cloud corners.

## Exact generation prompt

```text
Use case: stylized-concept
Asset type: production bitmap stationery background for an in-browser wedding Polaroid maker.
Primary request: Create one flat, full-bleed portrait 4:5 image, ideally 1200 × 1500 pixels (1024 × 1280 if that is the available 4:5 output size). A quiet, luxurious wedding instant-film stationery surface in warm ivory #f7f2e8, with very subtle fine paper grain.
Style/medium: delicate, sparse watercolor and refined printed stationery, elegant and light, inspired by a wedding flight journal.
Composition: This is the entire flat background artwork, viewed perfectly straight on. Keep the central photo-overlay region completely plain ivory: from 6% to 94% of the canvas width and from 5% to 75% of its height. Keep the footer center completely empty from 77% to 96% of canvas height for a caption, date and existing monogram to be added by software. These two reserved areas must contain no illustration, decoration, lines, borders, text, photo placeholder, shading gradients or objects; only the very subtle ivory paper surface.
Decorations: Very sparse, pale blue-gray watercolor cloud wisps with a faint warm gold tint, confined to the extreme outside edges. A small tasteful sprig of white jasmine with muted delicate leaves tucked into the extreme bottom-right edge; keep it out of the empty footer center. One tiny illustrated folded-paper airplane and a very fine muted gold flight-path accent confined to an upper outer corner, outside the reserved photo area. The artwork should feel almost empty and never ornate.
Color palette: predominantly warm ivory #f7f2e8, with pale blue-gray cloud washes and restrained pale gold #c4a367 details.
Constraints: absolutely no text, letters, numerals, logos, monograms, typography, signatures or watermarks anywhere. No people, no photographs, no actual photo, no visible photo placeholder rectangle, no product mockup, no perspective, no table, no props, no cast shadow around an object, no separate physical card edges. No new logo. Do not illustrate the layout measurements or guides. The image itself is the full-bleed flat stationery texture, usable as a border background behind a square photograph.
```

