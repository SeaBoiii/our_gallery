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

## Scope and validation

The home page and administration are gallery-only. Old `/guestbook` links redirect to `/gallery`; the public greeting API is retired. Historical data and migrations remain intact. Media uploads, approval, original files, day associations and the original download-release date remain in place.

The journal grid preserves DOM/keyboard reading order. Photos keep their aspect ratios; videos retain a play indicator and open in the existing viewer. The in-app browser was unavailable during this implementation, so responsive CSS and automated interactions were checked, but screenshots and visual browser review could not be completed.
