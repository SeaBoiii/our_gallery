# Archive build and restore runbook

Last reviewed: 6 September 2026.

## Build a final archive

1. In `/admin/settings`, switch the event mode to `post-wedding` or `archive`. This disables guest uploads; `archive` also disables semantic and Find Me traffic.
2. In `/admin/archive`, create an all-event inventory (normally 5 GiB shards). The snapshot includes pending, approved, and rejected non-deleted media plus metadata as it exists at that moment.
3. Record the returned job UUID. On a trusted Node.js 24+ machine, set these variables without committing them:

   ```bash
   export ARCHIVE_API_URL=https://gallery-api.aleemxnurul.love
   export ARCHIVE_BUILDER_TOKEN='the same independent Worker secret'
   export R2_ACCOUNT_ID='your account id'
   export R2_BUCKET_NAME='aleem-nurul-gallery'
   export R2_ACCESS_KEY_ID='bucket-scoped key id'
   export R2_SECRET_ACCESS_KEY='bucket-scoped secret'
   ```

   PowerShell uses `$env:NAME = 'value'` for the current process.

4. Preview the immutable shard plan without claiming or writing it:

   ```bash
   npm run archive:build -- --job <JOB_UUID> --all --shard-size 5GB --dry-run
   ```

5. Build and upload:

   ```bash
   npm run archive:build -- --job <JOB_UUID> --all --shard-size 5GB
   ```

6. If the process stops, use the same trusted machine and state directory:

   ```bash
   npm run archive:build -- --job <JOB_UUID> --all --shard-size 5GB --resume
   ```

   `--resume` reuses registered complete parts and locally recorded uploaded parts only when their persisted plan hash agrees. Do not edit `.archive-state/<JOB_UUID>.json` or copy it through an untrusted system. The file contains no R2 secret, but it is authority-adjacent job state.

7. A one-event maintenance run is supported:

   ```bash
   npm run archive:build -- --job <JOB_UUID> --event solemnisation --resume
   ```

   An all-event job remains `partial` until resumed with `--all`. Prefer separate event-scoped jobs when an independently complete single-event archive is desired.

8. The Worker marks a job complete only after validating exact active-inventory coverage, persisted plans, original checksums, non-overlapping parts, object sizes, and all four integrity artifacts. Download links are then enabled in `/admin/archive` for 10 minutes by default.

The builder streams one original into one ZIP64 shard at a time with compression disabled. This preserves already-compressed wedding media, makes byte output deterministic for the same source bytes/plan/library version, and avoids holding multi-gigabyte archives in RAM. Inventory and manifest metadata are held in memory, and every shard is capped at 10,000 files. Run a representative 100,000-item staging rehearsal and monitor Node heap usage—especially with unusually long filenames/messages—instead of assuming a fixed RAM requirement. The one-statement inventory snapshot must also be benchmarked against the target D1 plan before the production run.

## Download layout

Keep the four global artifacts together at the archive root:

```text
Aleem-Nurul-Wedding-Archive/
├── README.txt
├── manifest.json
├── manifest.csv
├── checksums.sha256
└── parts/
    ├── <SOLEMNISATION_EVENT_UUID>/
    │   ├── AN-Wedding-Solemnisation-Part001.zip
    │   └── ...
    └── <RECEPTION_EVENT_UUID>/
        ├── AN-Wedding-Groom_s-Reception-Part001.zip
        └── ...
```

The event UUID appears in `manifest.json` and in the admin job metadata. The paths matter: `checksums.sha256` references part files as `parts/<event-id>/<filename>`. Every ZIP also contains a part-local `manifest.json`, `manifest.csv`, and `checksums.sha256` for independent recovery.

Inside a part, original and sidecar paths are deterministic:

```text
21-Aug-Solemnisation/originals/000001_IMG_9182.JPG
21-Aug-Solemnisation/metadata/000001_IMG_9182.json
22-Aug-Groom_s-Reception/originals/000001_IMG_2144.HEIC
```

The manifest preserves the exact supplied original filename separately from the sanitized archive path.

## Verify before deleting any cloud data

Run verification from the archive root.

First verify the downloaded part ZIPs (the root checksum file also lists originals that are still inside those ZIPs):

```bash
grep '  parts/' checksums.sha256 | sha256sum --check -
unzip -t parts/<EVENT_UUID>/AN-Wedding-Solemnisation-Part001.zip
```

PowerShell (one file):

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\parts\<EVENT_UUID>\AN-Wedding-Solemnisation-Part001.zip'
```

Compare that result with the same filename in `checksums.sha256`. Also:

1. Parse `manifest.json` with an independent JSON tool.
2. Confirm its media count and byte sum agree with the admin snapshot.
3. Extract each part into its own temporary directory. Each ZIP has root-local part manifests, so extracting every part directly into one directory would overwrite those small files.
4. Merge only the event folders from those temporary directories into one clean extraction root; preserve each part's local manifests in a separately named audit folder if desired.
5. Place the downloaded `parts/` tree beneath that extraction root and run `sha256sum --check checksums.sha256` there. It can now verify both merged originals and the downloaded ZIPs.
6. Open at least the first and last original from every part, including JPEG/HEIC/video examples.
7. Preserve two verified copies on different storage media, ideally with one off-site.
8. Record the job UUID, verification date, verifier, builder dependency lockfile, and any known missing/deleted originals.

Do not delete `originals/` from R2 automatically. Original-media deletion always requires a separate deliberate administrative decision.

## Restore without this application

No app-specific decryption or database is required:

1. Verify part hashes against the root `checksums.sha256`.
2. Extract each part into its own staging directory and verify its part-local `checksums.sha256` there.
3. Merge the event folders into one destination root. Event/original paths are deterministic and non-overlapping; do not overwrite the root-level global artifacts with a ZIP's part-local artifacts.
4. Use the global `manifest.csv` for spreadsheet/catalog import or `manifest.json` for a programmatic rebuild.
5. Verify the merged originals and retained `parts/` tree with the global `checksums.sha256`.
6. Sidecar JSON files in each event's metadata tree retain the per-item fields needed to reconstruct an independent gallery.

## Rebuild and invalidation

An archive inventory is immutable. New uploads, moderation changes, AI reprocessing, and category edits after snapshot creation do not rewrite it. Create a new job for a new final state.

Deleting source media contained by a completed job changes that job to `failed` and disables its signed-download API. This prevents presenting the old snapshot as current, but it does not delete already built R2 ZIP objects. Decide separately whether those private bytes belong under archival retention or deletion obligations, then remove only exact confirmed `archives/<job-id>/...` keys with a reviewed R2 inventory. Never apply an automatic lifecycle to `originals/` or the whole `archives/` prefix.

Cancelled/failed builders abort active multipart uploads when they can. An operating-system or network hard stop can still leave an incomplete multipart upload or an unregistered immutable part. The committed R2 lifecycle aborts only incomplete multipart uploads beneath `archives/` after one day; it does not delete completed archive objects. Audit keys beneath the exact job prefix after failures, retain registered parts needed for `--resume`, and remove completed objects only when proven unreferenced by D1. Never add a blanket expiry/delete rule for the whole `archives/` prefix.
