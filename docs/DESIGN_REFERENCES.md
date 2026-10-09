# Gallery journal — September 2026

The gallery-only redesign follows the invitation character of the earlier site: soft sky, the supplied monogram, warm paper, navy typography and small travel details. Photographs and videos are the only public contributions.

## Internet references consulted

- [Our Flight](https://github.com/SeaBoiii/our_flight): the wedding series' sky, monogram, navy/ivory/gold palette and travel language. Existing user-owned sky and font assets are reused.
- [Kinfolk's redesign, discussed with creative director Charlotte Heal](https://www.itsnicethat.com/articles/kinfolk-redesign-charlotte-heal): varied photograph sizes, white frames and editorial pacing. Applied as full-image paper mounts, numbered captions and alternating journal spreads, with a compact grid for quicker browsing.
- [Kinfolk Travel](https://www.kinfolk.com/stories-categories/travel/page/2/): a quiet travel-journal tone and an emphasis on photographs and short captions.
- [Duo Collective's destination wedding and travel design](https://duocollective.com/destination-wedding-travel-planner-website-design): restrained travel illustration alongside wedding typography. Applied as a folded-paper plane, a dotted flight path and a small itinerary strip.

These are design references; no third-party photography, layouts or written copy were copied into the application.

## In-browser keepsake studio

- [Angie's online photobooth](https://getangie.com/photobooth): the user's requested reference for a browser photobooth. Its client-rendered interface was not inspectable through the available text browser during this update.
- [PicaPica](https://picapica.app/): a four-shot countdown sequence followed by styling and saving the finished strip.
- [Pixlery](https://pixlery.com/tools/online-photo-booth/): camera or local-file input, individual retakes, rearranging photos, crop adjustment and local export.
- [TripMemo's Polaroid generator](https://tripmemo.app/polaroid-frame-generator): a live crop/frame/caption preview and local image processing.
- The wedding palette, original monogram, Instrument Serif and flight details come from this gallery and Our Flight. Ivory, airmail and cloud frames support a four-shot strip (900 × 2700), a four-frame grid (1600 × 1900), and a single Polaroid (1200 × 1500). The grid and single-photo layouts reuse the original cloud stationery; the strip uses new dedicated 1:3 artwork. Prompts are documented in [POLAROID_ASSETS.md](POLAROID_ASSETS.md) and [DAY_VISIBILITY_ASSETS.md](DAY_VISIBILITY_ASSETS.md).

The same canvas renderer produces the preview and exported PNG. Local photos and camera frames stay on the device until the guest explicitly chooses **Add to gallery**, which opens the existing moderated uploader. No existing gallery original or timed download is fetched by the studio. All nine frame/layout combinations were rendered through the production module using an isolated native canvas adapter, exported as PNG, and visually inspected, including enlarged footers to verify the text clears the lower rule. This validates the export artwork, not the browser UI or a physical camera. Development sample images are used only in these local verification artifacts.

## New illustration

`src/components/PaperPlane.tsx` is an original SVG illustration with shaded paper folds and a soft shadow. It is rendered directly as code, needs no external graphics runtime and has no continuous animation. The entrance animation respects the site's reduced-motion setting. All decoration is hidden from assistive technology.

## Keepsake, image viewer and live-wall refinement

- [The RSVP invitation](https://rsvp.aleemxnurul.love/) and its local Our Flight source confirm the existing Instrument Serif family, with a smaller italic gold ampersand. The canvas renderer now loads both regular and italic local font faces, centres the names as measured text runs and gives the date a larger navy line.
- The printed divider sits above the names in every layout, including prints without a caption. An original canvas paper plane, an “Our Wedding” label for uncaptioned prints, and a small “Singapore / Forever” route detail complete the footer around the authentic offset monogram. These remain crisp procedural elements; the existing cloud stationery is reused.
- [Pixieset Client Gallery](https://pixieset.com/client-gallery/) and [Pic-Time Slideshows](https://www.pic-time.com/features/slideshows) informed the photograph-first viewer and presentation wall: an immersive dark surround, restrained framing and a distinct area for the photograph's story. The wedding implementation uses navy, ivory, fine gold rules and Instrument Serif.

No reference-site photography or illustrations were copied. Preview and PNG continue to use identical geometry. Export verification covers all layouts, frames, both individual dates, empty/whitespace captions and long captions, with additional unbroken-text checks. Browser preview was unavailable for this update; automated interaction tests and native canvas export inspection are recorded separately from visual browser testing.

Validation: 381 tests across 45 files, lint, the frontend production build and Worker dry-run build pass. Fifty-seven native PNG exports matched preview pixels exactly; contact sheets and the complete strip were inspected. Automated checks include stable-URL image retries, focus/navigation, source filtering, paused rotation, reduced-motion video playback and fullscreen failure recovery. This release changes frontend presentation only.

## Scattered live journal

The live wall now cycles through six composed arrangements instead of keeping the photograph in one fixed column. A dominant complete photograph or video sits among up to two smaller guest-photo prints, with tape, offset paper, a route line, a Singapore postmark and an ivory journal note. The visual references are [Canva's travel scrapbook layouts](https://www.canva.com/scrapbooks/templates/travel/), [Artifact Uprising's travel scrapbook](https://www.artifactuprising.com/photo-books/custom-photo-scrapbook-album/travel) and [Pic-Time's multi-image storytelling](https://www.pic-time.com/features/slideshows). No third-party imagery is used; the decorative details are CSS and SVG.

Each slide keeps its arrangement and companion selection through background polling and pause. Companion IDs are resolved against the latest approved, visible source on every render so deleted, rejected or hidden photographs disappear. Companions use lightweight thumbnails and cannot play extra videos. The main image remains uncropped; videos remain upright. QR and controls have a separate stable area, and mobile uses a staggered flowing layout. All animation respects reduced motion. Browser preview remained unavailable; automated interaction and static layout checks do not substitute for browser screenshots.

Journal validation: 388 tests across 45 files, lint and the production build pass. Fifteen live-wall tests cover six-layout cycling, pause/polling stability, companion removal, source/day transitions, late responses, single photos and videos. Independent geometry review checked rotation clearance and caption placement, including 24 aspect-ratio/viewport combinations for the closest spread.

## Presentation and framing adjustments

The live-wall ivory mounts now follow each image's own proportions inside the existing scattered layout bounds. The original monogram is presented in a light treatment directly on navy. `/live` keeps the QR slip on the right; `/live?qr=left` moves it to the left, and `/live?qr=right` selects the default explicitly. The QR still links to the public gallery. On small screens the left variant precedes the photographs and the default follows them.

The image viewer's note is reduced to the guest's message, shared-by credit and a small wedding date. The displayed date comes from the media's wedding album: the API does not contain a verified camera capture timestamp. Notes expand naturally instead of using a nested scroll area; the viewer body can scroll for longer messages. Mobile and tablet journal browsing keeps smaller, varied-size prints in staggered rows, with gentle rotations, natural photo proportions and tap-to-open viewing.

The photobooth camera viewfinder and captured image use the active layout's centred photo window: 4:3 for strips and square for grid/single frames. This avoids previewing the full camera sensor and then unexpectedly cropping it only after insertion. Replacement files start with a centred crop while existing edits remain attached to their own photos.

Validation: 424 tests across 46 files, lint and the frontend production build (including Worker type checks) pass. New coverage includes fitted image dimensions, resize recovery, QR address navigation, centred camera capture and replacement crops, and simplified viewer notes. Static geometry review checked mobile print clearance across 320–959px; browser screenshots and physical-camera testing were unavailable.

## Scope and validation

The home page and administration are gallery-only. Old `/guestbook` links redirect to `/gallery`; the public greeting API is retired. Historical data and migrations remain intact. Media uploads, approval, original files, day associations and the original download-release date remain in place.

The journal grid preserves DOM/keyboard reading order. Photos keep their aspect ratios; videos retain a play indicator and open in the existing viewer. The in-app browser was unavailable during this implementation, so responsive CSS and automated interactions were checked, but screenshots and visual browser review could not be completed.

## Golden Hour Arrivals (October 2026)

The gallery now shares Our Flight's tokens instead of its own drifted palette. Navy `#033A4E` and champagne `#D9B472` were sampled from the A&N monogram with Pillow, and are the same values Our Flight uses. IBM Plex Mono and the cotton-paper tile are copied from `our_flight/src/assets` with their licences. The metaphor moves from a departure (the invitation) to an *arrivals hall*:
- day tabs carry the flight codes AN2108 / AN2208;
- the photo booth is a ticket with a perforated stub;
- the projector wall shows one large photograph, with newly approved photos "landing" next.

The full rationale, craft floor and projector rules are in [`DESIGN_LANGUAGE.md`](../DESIGN_LANGUAGE.md). Guest video is retired from the interface (photos only). The scattered six-layout live journal was replaced because it rendered the photograph at about 25% of a projector screen.

Validation:
- Lint, 409 tests across 45 files, and the production build pass.
- Playwright screenshots were reviewed for `/`, the viewer, the upload sheet, `/photobooth` and `/qr` at 360, 390, 412, 768 and 1280, and for `/live` at 390, 1280×720, 1920×1080 and 3840×2160, with no horizontal overflow and no console errors.
- The live-wall QR decodes to the gallery URL from the 720p and 1080p screenshots, and the printable card's QR decodes too.

A real projector, venue Wi-Fi and physical phones (iOS Safari camera) still need a rehearsal.

### Refinements after review

- The original invitation-cover hero and photo booth banner are restored at the couple's request. They are recoloured to the monogram palette, with text at least 11 px (labels) and 16 px (body).
- The gallery opens on the Journal spread on desktop and on the Grid on phones.
- On every print layout and frame, the booth's A&N monogram is a large, whitewashed stamp tilted into the bottom-left corner. It stays below the names and may sit faintly behind the date lines. All nine layout and frame combinations were rendered in Chromium and inspected, with empty, short and long captions.
- The live wall became a *journal pile*: taped Polaroids settle onto the previous prints, beside a postmarked journal note and a perforated boarding-pass QR. The QR decodes from 720p, 1080p and 4K screenshots.
