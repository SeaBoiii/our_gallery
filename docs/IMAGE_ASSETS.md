# Image assets

## Aleem & Nurul monogram

- `public/monogram-original.png` is the exact transparent 768 × 512 PNG supplied by the user.
- `public/monogram.png` is the display-ready 599 × 381 crop used throughout the interface. It was copied from the user-owned `our_flight` visual reference without modifying that sibling project.
- `public/favicon.png` is the square ivory favicon treatment of the same mark.
- The monogram is presented as supplied: intertwined deep-teal A/N letterforms with the gold ampersand and flourish. No generated reinterpretation is used in the site.

## Generated gallery artwork

The project uses one original image generated with OpenAI's built-in image-generation mode. It was visually inspected at 1536 × 1024 before being copied and cropped into the repository.

## Saved files

- Original generation: `C:\Users\seabo\.codex\generated_images\01a052b7-f1cd-70e2-baa5-9ba136a5f2bd\exec-aeee4557-7ca3-4bf8-a9a2-b518b4d10d93.png`
- Social card: `public/og.png`
- Development-only crops: `public/samples/sample-1.webp` through `public/samples/sample-4.webp`
- Development video preview: `public/samples/sample-video.mp4` — a 4-second, silent H.264 baseline motion clip derived locally from generated `sample-4.webp`; no additional image-generation call or third-party footage was used.

The soft cloud files in `public/` were copied from the user-owned sibling `our_flight` project to preserve the established wedding design language. That source repository was not modified.

## Exact generation prompt

```text
Use case: ads-marketing
Asset type: 1536×1024 landscape Open Graph social card, with the right-side imagery also designed for four independent development-gallery thumbnail crops.

Primary request: Create one sophisticated branded social card for a Singapore wedding guest gallery, blending the quiet luxury of a premium airline lounge, refined wedding editorial styling, and luminous soft-cloud atmosphere.

Scene/backdrop and composition: Exact 3:2 landscape canvas, 1536×1024. Divide the canvas vertically with a crisp straight seam: the left 40% is warm ivory premium boarding-pass-inspired stationery, and the right 60% is a precise borderless 2×2 contact sheet of four distinct photorealistic wedding still-life vignettes. The four right-side panels must be exactly equal rectangular crops, aligned edge-to-edge with clean straight boundaries, absolutely no gutters, borders, frames, rounding, overlap, or text. Each panel must read as a complete, individually crop-ready photograph:
1. top-left: ivory and pale-blue wedding florals beside exactly two restrained gold wedding rings, authentic petal and metal texture;
2. top-right: elegant champagne coupes and warm candlelight, intimate reflective glass and natural flame glow;
3. bottom-left: elegant reception-table place setting with deep-teal stationery, refined linen, porcelain and cutlery;
4. bottom-right: soft evening dance-floor bokeh lights with pale clouds visible through a window, dreamy but photorealistic, no people.

Left stationery panel: Warm ivory #fbfaf7 with subtle natural paper grain and paper highlights #fffefa, ample negative space, perfectly centered typographic hierarchy. Use only the four exact text strings below, each rendered once. “ALEEM × NURUL” is the principal large deep-teal elegant editorial serif line. “FLIGHT MEMORIES” is small uppercase deep-teal sans-serif microtype. “OUR DAY, THROUGH YOUR EYES.” is a refined deep-teal editorial serif headline with balanced line breaking if needed. “21 — 22 AUGUST 2027” is small uppercase deep-teal sans-serif microtype. Add one thin restrained metallic-gold horizontal rule, purely decorative and without labels. No other marks, symbols, numbers, captions, or microtext.

Text (verbatim, exact):
"ALEEM × NURUL"
"FLIGHT MEMORIES"
"OUR DAY, THROUGH YOUR EYES."
"21 — 22 AUGUST 2027"

Typography and spelling requirements: Render every quoted line exactly as written, with fully readable spelling and punctuation. Preserve the multiplication sign × between the names, the comma and period in the headline, and the em dash — between the dates. Do not substitute hyphens, ampersands, extra punctuation, or extra words.

Style/medium: Premium photoreal wedding editorial photography integrated with tactile luxury stationery; sophisticated advertising art direction; authentic natural textures; clean, restrained layout.
Lighting/mood: Calm, luminous, expensive, intimate; soft diffused daylight on paper and florals, warm candle glow, quiet airy cloud softness; no dark heavy vignette.
Color palette: ivory #fbfaf7, paper #fffefa, deep teal #173c44, muted sky blue #6b9bab, restrained metallic gold #cfad64.
Materials/textures: finely grained cotton paper, delicate flowers, polished gold rings, crystal glass, linen, porcelain, brushed cutlery, gentle window reflections.

Constraints: one single finished image; no logos; no watermark; no brand names; no cartoon aircraft; no aircraft illustration; no boarding gate codes; no barcode; no QR code; no ticket numbers; no extra text anywhere; no identifiable people, faces, silhouettes, hands, or bodies; no dark heavy vignette; no visible trademarks. Keep the left-to-right 40/60 split exact in appearance. Keep the right 2×2 image area strictly borderless and gutterless.
```
