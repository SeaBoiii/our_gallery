# Design language: Golden Hour Arrivals

Our Flight, the invitation, is the *departure*: a story that runs from midnight to golden hour. The gallery is the *arrivals hall*, where everyone's photographs land. It uses the same stationery (cotton paper, champagne gold, boarding-pass details), designed for phones first and, on the live wall, for a projector across a reception hall.

## Why this direction

| Choice | Reason |
|---|---|
| **Same series as Our Flight** | Guests arrive from the invitation. The gallery should feel like its next page, not a separate product. Tokens, type families and texture come straight from `our_flight/src/design/tokens.css`. |
| **Palette sampled from the monogram** | The A&N mark is teal-navy `#033A4E` and champagne `#D9B472`. The previous gallery navy (`#081B31`) and gold (`#A48348`) had drifted, so the logo never quite matched the page. |
| **Instrument Serif · IBM Plex Mono · system sans** | Serif for display, mono only for real data (flight codes AN2108 / AN2208, dates, counts), and the system sans for reading. All self-hosted with their OFL licences in `public/fonts/`. |
| **Arrivals metaphor** | Day chapters are flight codes, the photo booth is a ticket with a perforated stub, and new photographs "land" on the live wall. These are gestures guests already know. |
| **Cotton paper + one songket edge** | The tactile language of the series. The *pucuk rebung* border appears only as a fine gold edge on a few surfaces. |
| **Photographs first** | Photos keep their own proportions and are never cropped in the viewer or on the wall. Decoration sits around them, never on them. |
| **Photos only** | Guests share photographs, not video. This keeps uploads quick on venue mobile data and moderation light. Legacy video items still render if one is ever approved. |

**Rejected:**
- **GSAP and scroll-scrubbed scenes:** a gallery has no narrative scroll to drive.
- **Smooth-scroll hijacking:** it fights native touch scrolling.
- **Script fonts:** hard to read.
- **Blur on in-flow cards:** GPU cost on phones.
- **The scattered six-layout live journal:** it rendered the photograph at about 25% of a projector screen. Its tactile character returns in the *journal pile* instead.
- **A blurred-photo "cinema" wall:** tried first and dropped. It was legible, but it read as a generic slideshow rather than the couple's journal.
- **Guest video:** see above.

## Craft floor

- **Mobile first:** design at 390 × 844, check 360 and 412, then enrich for 768 and 1280.
- **Text sizes:** body ≥ 16 px; mono labels ≥ 11 px with 0.08 em tracking.
- **Targets and actions:** tap targets ≥ 48 px, primary actions in the thumb zone.
- **One elevation per surface:** a tinted shadow *or* a hairline, never both. Paper radii are 4–14 px.
- **Text-safe gold:** `--gold-text` (AA on ivory) for small gold text. `--gold` is decorative only.
- **Themed browser surfaces:** selection, caret, accent colour, scrollbar and focus rings.
- **Reduced motion:** content is always visible. Motion only embellishes its arrival.

## Tokens (`src/styles/tokens.css`)

- **Colour:**
  - `--midnight`, `--navy-deep`, `--navy`, `--ink`, `--muted`
  - `--ivory`, `--paper`, `--sand`, `--line`, `--line-strong`
  - `--gold`, `--gold-soft`, `--gold-deep`, `--gold-text`, `--gold-foil-ink`
  - Legacy aliases (`--accent`, `--accent-deep`, `--metal`, `--soft`, `--serif`, `--mono`) keep older views such as admin consistent.
- **Type:** the `--step-hero` … `--step-3` display scale, and `--text-label` / `--text-meta` / `--text-body` for running text.
- **Surfaces:** `--paper-texture` (14 KB cotton tile, multiplied), `--songket-border`, `--shadow-paper`, `--shadow-lift`, `--radius-paper`.
- **Motion:** `--ease-out` (expo-like); no bounce.

## Chapters

| Surface | Hero moment (mobile) | Notes |
|---|---|---|
| Home: invitation cover | The original journal cover: centred "Our journey, *through your eyes*", postmark, paper plane, dashed flight path, vertical margin note and itinerary | Kept at the couple's request, recoloured to the monogram palette with readable sizes. Actions: **Share your photos**, then **Take a photo** and **Photo booth** as equal buttons, so the booth is advertised from the first screen. The postmark and margin note appear only from 1200 px, where they clear the headline. |
| Photo booth banner | A tilted four-shot strip beside a short invitation | The original banner, restyled. |
| Gallery | Flight-code day tabs; justified rows of natural-ratio prints | Phones open on *Grid*; desktops (≥ 960 px) open on the editorial *Journal* spread. Both stay one tap away. |
| Viewer | Midnight surround, photograph uncropped, paper note card | Swipe and keys unchanged. |
| Add photos | Bottom sheet on phones, dialog on desktop | Photo-only copy and validation. |
| Photo booth | Live print preview, four steps, sticky action bar | Print colours follow the monogram; the A&N is a large, whitewashed (16% opacity) stamp tilted into the print's bottom-left corner. It may sit faintly behind the date lines but always stays below the names. |
| Live wall: journal pile | Each photograph arrives as a taped Polaroid and settles on the two prints before it | A paper journal note with a postmark, a boarding-pass QR with a perforated stub, a dusk sky and a dashed flight route. Built for 1920 × 1080 and 4K projectors. |
| QR card | Printable boarding pass | Print CSS. |

## Live wall: projector rules

- **Layout:** 16:9 first, everything sized in `vmin`/`clamp()` so 720p, 1080p and 4K scale together.
- **Legibility:** text ≥ 24 px at 1080p; rules ≥ 2 px; high-contrast ivory on `--midnight` (projectors wash out low-alpha and thin lines).
- **QR:** ≥ 280 px at 1080p, dark modules on ivory with a full quiet zone.
- **Running unattended:** cursor and controls hide after 3 s idle; a best-effort Screen Wake Lock keeps the display on.
- **Rotation:** photographs approved since the last poll are shown next with a "Just landed" chip. Videos are skipped. Prints are numbered by arrival ("Memory Nº 014").
- **Motion:** where the View Transitions API exists, the current print slides onto the pile and the new one drops in; elsewhere the new print drops in with CSS. Reduced motion swaps instantly.

## Motion

CSS only, plus the View Transitions API on the live wall. Transform and opacity, `--ease-out`, durations of 180–1200 ms. There are no looping ambient effects behind text.

## Performance

Critical path: HTML, CSS, the entry chunk, the regular serif (preloaded) and the hero sky AVIF. The mono font and paper texture are small (15 KB and 14 KB) and load with `font-display: swap`. Gallery thumbnails are lazy, with aspect-ratio boxes so nothing shifts. The live wall preloads only the next photograph.
