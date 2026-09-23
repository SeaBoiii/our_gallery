# Shared gallery dates

The public gallery uses one server-authoritative mode for all visitors. This is not invitation-specific access. Automatic mode uses Singapore midnight: 21 August before 22 August 2027, 22 August during that date, and both dates from 23 August.

Admin Settings offers 21 August, 22 August and Both days. Both days includes and disables the individual date buttons. Toggle Both days off to restore the previous single date. Manual choices expire at the next scheduled transition; choices after 23 August persist until Resume automatic schedule. Global upload closure does not hide photographs, and admin moderation always covers both dates.

## Policy and storage

- Additive migration `0004_gallery_visibility.sql` stores `settings.gallery_visibility`; IDs, slugs, object keys, media and greetings remain intact. Legacy per-day upload columns are retained but no longer control uploads.
- `/api/gallery/config` returns only visible events and a short server-timed validity lease. The frontend refreshes every 25 seconds, on focus, and at expiry/transition. Unverified configuration clears public gallery/live content while preserving local photobooth/upload drafts.
- Gallery events, lists, deep links, live sources and new preparations share the policy. Approved display images, thumbnails, video playback, and original downloads pass through `/api/media/:id/:variant` with no-store responses. Access precedes ranges, HEAD metadata and conditional responses.
- Original downloads still open at `2027-08-23T00:00:00+08:00`; their five-minute signed URLs now point to the Worker. A valid prepared upload retains its original album and existing authorization window across a policy change.
- Photobooth exports always contain a single date. Gallery submission locks that printed album. Date changes preserve editable photos/crops but require a new print before submission.

Already viewed, buffered, saved or printed material cannot be recalled.

## Release order and rollback

1. Verify migrations in an isolated database containing existing media; run lint, all tests, frontend build and Worker dry-run.
2. Apply migration and deploy the compatible API/media proxy first. Migration initially keeps a temporary manual-both mode so the existing frontend remains compatible during rollout.
3. Record successful proxy deployment time. Publish the new frontend through the existing GitHub Pages workflow only after backend verification.
4. Wait at least 15 minutes after the old API stops issuing public R2 URLs, then activate automatic scheduling through the authenticated settings API. A release operator can use authenticated Wrangler/D1 with an accompanying settings audit record when an admin session is unavailable.
5. Verify 21-only, 22-only and both modes on the live config/events/gallery/detail/media endpoints, restore automatic mode, and confirm media counts/bytes remain intact.

Rollback may restore frontend presentation only while retaining the policy-enforcing API and migration. Never roll the Worker back to a version that exposes unrestricted public URLs. If a replacement Worker is required, deploy a forward fix or another policy-enforcing version. Do not remove stored media or greetings.

## Verification artifacts

Release checks: 366 tests passed across 45 files; lint, frontend production build, Worker TypeScript and Worker dry-run passed. The Worker subset contains 154 tests, including Singapore boundaries, slow storage responses, conditional/range access, upload authorization expiry, and authenticated/audited settings.

The additive migration was also applied through Wrangler to an isolated local D1 database: 3 seeded media rows and 103,389,594 original bytes remained intact, with unchanged associations and legacy upload flags. The foreign-key check was clean. The production baseline immediately before migration was 5 media rows, 8,271,263 total declared bytes, with 4 approved and 1 rejected.

The native canvas matrix rendered 54 combinations: three layouts, three frames, both dates, and empty/whitespace/long captions. Preview and exported PNG pixels matched exactly. Enlarged footer sheets and the complete strip were visually inspected. The native adapter and outputs are local verification artifacts under ignored `.wrangler/polaroid-qa/`.

Three additional exports checked maximum-length unbroken captions in two lines across all layouts.

The browser runtime reported no connected browser. Responsive CSS and automated keyboard/focus/interactions were inspected/tested; a real browser viewport sweep from 360px to desktop could not be performed in this environment.

Artwork prompts and provenance: [DAY_VISIBILITY_ASSETS.md](DAY_VISIBILITY_ASSETS.md).
