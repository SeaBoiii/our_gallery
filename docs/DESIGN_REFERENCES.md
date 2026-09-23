# Gallery journal — September 2026

The gallery-only redesign follows the invitation character of the earlier site: soft sky, the supplied monogram, warm paper, navy typography and small travel details. Photographs and videos are the only public contributions.

## Internet references consulted

- [Our Flight](https://github.com/SeaBoiii/our_flight): the wedding series' sky, monogram, navy/ivory/gold palette and travel language. Existing user-owned sky and font assets are reused.
- [Kinfolk's redesign, discussed with creative director Charlotte Heal](https://www.itsnicethat.com/articles/kinfolk-redesign-charlotte-heal): varied photograph sizes, white frames and editorial pacing. Applied as full-image paper mounts, numbered captions and alternating journal spreads, with a compact grid for quicker browsing.
- [Kinfolk Travel](https://www.kinfolk.com/stories-categories/travel/page/2/): a quiet travel-journal tone and an emphasis on photographs and short captions.
- [Duo Collective's destination wedding and travel design](https://duocollective.com/destination-wedding-travel-planner-website-design): restrained travel illustration alongside wedding typography. Applied as a folded-paper plane, a dotted flight path and a small itinerary strip.

These are design references; no third-party photography, layouts or written copy were copied into the application.

## In-browser keepsake studio

- [Angie's online photobooth](https://getangie.com/photobooth): browser camera capture, a short countdown, and a finished photo keepsake. This site uses a single-camera wedding flow; no shared rooms or third-party photobooth service are involved.
- [TripMemo's Polaroid generator](https://tripmemo.app/polaroid-frame-generator): a live crop/frame/caption preview and local image processing.
- The wedding palette, original monogram, Instrument Serif and flight details come from this gallery and Our Flight. Ivory, airmail and cloud frames are rendered at 1200 × 1500 pixels. The original generated cloud stationery asset and exact prompt are documented in [POLAROID_ASSETS.md](POLAROID_ASSETS.md).

The same canvas renderer produces the preview and exported PNG. Local photos and camera frames stay on the device until the guest explicitly chooses **Add to gallery**, which opens the existing moderated uploader. No existing gallery original or timed download is fetched by the studio. Actual frame outputs were rendered through the production rendering module using an isolated native canvas adapter and visually inspected; this validates the export artwork, not the browser UI or a physical camera.

## New illustration

`src/components/PaperPlane.tsx` is an original SVG illustration with shaded paper folds and a soft shadow. It is rendered directly as code, needs no external graphics runtime and has no continuous animation. The entrance animation respects the site's reduced-motion setting. All decoration is hidden from assistive technology.

## Scope and validation

The home page and administration are gallery-only. Old `/guestbook` links redirect to `/gallery`; the public greeting API is retired. Historical data and migrations remain intact. Media uploads, approval, original files, day associations and the original download-release date remain in place.

The journal grid preserves DOM/keyboard reading order. Photos keep their aspect ratios; videos retain a play indicator and open in the existing viewer. The in-app browser was unavailable during this implementation, so responsive CSS and automated interactions were checked, but screenshots and visual browser review could not be completed.
