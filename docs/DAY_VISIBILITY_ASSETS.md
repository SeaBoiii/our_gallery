# Day-separated gallery artwork

Created 23 September 2026 with the built-in `image_gen.imagegen` tool. The tool does not expose a selectable or reported model version. Both outputs were copied unchanged and visually inspected; no CLI/API fallback, compositing or bitmap editing was used.

## Photobooth strip stationery

- Asset: `public/photobooth-strip-clouds.png`, PNG, 724 x 2172 pixels, exact 1:3 ratio.
- Mode: generation with the existing `public/polaroid-clouds.png` as a style reference.
- Original: `C:/Users/seabo/.codex/generated_images/01a0cc8f-bfa9-7830-8b81-13401afdac13/exec-cd6e13a1-ebb2-4a51-8a35-4f5fbeb6b3c0.png`.
- SHA-256: `6261744d913da831b8d17b17f36c71382f24519fd7facfb758eaed0ea97e4fc7`.
- Use: full strip background. Names, date, rule and the authentic monogram remain separate canvas layers. The four opaque photo windows preserve their existing geometry. The strip artwork is not cropped from the older 4:5 image.

Exact prompt:

```text
Use case: stylized-concept. Create a NEW production wedding photobooth stationery background inspired by the attached reference, not a mockup. The output must be a very tall portrait strip with EXACT 1:3 aspect ratio, ideally 1024 by 3072 pixels. Use the reference only for matching the quiet watercolor style: warm ivory #f7f2e8 handmade paper, very pale blue-gray clouds, restrained pale gold #c4a367 edges, a tiny folded paper airplane and white jasmine. Compose artwork specifically for this tall narrow format; do not crop or stretch the 4:5 reference. FULL-BLEED FLAT stationary texture, viewed square-on, without physical paper edges or shadows. Reserve the central 84% of width from x8% to92%, and y2% to89%, as completely plain ivory because four opaque photographs will be overlaid there by software; NO frames, photo placeholders or ruled boxes. Decoration is confined to the outside 7% left/right margins, the uppermost 2% and lowermost 2% and very subtle footer corners. Keep y89% to98%, x8% to92% quiet ivory for names and a date to be typeset later. Tiny tasteful paper plane at extreme upper right; faint cloud washes near upper-left and lower corners; restrained jasmine sprig tucked into extreme bottom-right, not intruding into footer-center. Maintain a continuous balanced border around the entire strip, not a large floral cluster. No text, letters, numbers, monogram, logos, dates, people, photographs, watermark, surface/table, perspective, tape or props. All typography and the authentic wedding monogram will be added by software.
```

## Date-free social card

- Asset: `public/og.png`, PNG, 1536 x 1024 pixels.
- Mode: edit of the existing social card; its bottom date was replaced by SINGAPORE.
- Original: `C:/Users/seabo/.codex/generated_images/01a0cc8f-bfa9-7830-8b81-13401afdac13/exec-1d59e2bf-39e4-4ad3-89e6-5041118c562f.png`.
- SHA-256: `8130b67918f6571acf31bdaead0dba9d6077a46efdb809f2117c3962f2beea3f`.
- Use: date-free social previews, with a new URL query version to refresh cached artwork.

Exact prompt:

```text
Use case: text-localization. Edit this existing wedding gallery social sharing card. Preserve its exact layout, navy serif names ALEEM & NURULAIN, ivory paper, thin gold rules, cloud photograph on the right, and all typography above the bottom date line. Remove only the bottom text '21 — 22 AUGUST 2027' and replace it with 'SINGAPORE' in the same restrained small navy uppercase tracked lettering, positioned on the same baseline. No day, month, year, or numerical date may appear anywhere in the output. Keep 'OUR WEDDING COLLECTION' and 'Our day, through your eyes.' exactly intact. Preserve original aspect ratio, ideally 1536 by1024 pixels. No new decorations or changes elsewhere.
```
