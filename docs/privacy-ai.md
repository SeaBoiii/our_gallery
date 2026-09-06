# AI and Find Me privacy design

Last reviewed: 3 September 2026.

This document records the privacy boundary for Aleem × Nurul — Flight Memories. It is an implementation guide, not a claim that a production face provider has already been approved. Production Find Me remains unavailable until the operator selects a provider with a verified no-retention contract, configures a matching private Vectorize index, and activates a model-specific calibration.

## Purpose and prohibited uses

Find Me performs voluntary selfie-to-photo visual-similarity search. It does not establish identity and must never attach a real-world name to a face. Results use cautious language such as “These memories may include you.”

The system must not create person profiles or infer identity, race, ethnicity, religion, gender, age, attractiveness, emotion, health, relationships, or other sensitive attributes. Guest names and messages are ordinary upload metadata and are never used as face labels or face-training targets.

## What is stored

For approved wedding photos that remain eligible for Find Me:

- private Vectorize face embeddings produced by the configured face model;
- D1 references connecting an opaque vector ID to its source media ID and face position;
- normalized bounding-box coordinates, optional provider quality score, provider/model/version, dimensions, metric, and index timestamp;
- an active calibration row for the exact provider/model/version/dimensions/metric tuple;
- a short-lived random search-session ID and expiry time, used only as operational metadata;
- AI captions, scene/object/quality output, controlled category assignments and confidence, semantic-vector references, model versions, task state, and safe error codes.

Vectorize is accessed only by the Worker. Neither face nor semantic vectors are returned to the browser.

## What is not stored

The Find Me request does not persist:

- the selfie in R2, D1, logs, or the gallery;
- the selfie query embedding in D1 or Vectorize;
- face crops in public or private object storage;
- a guest identity or a persistent guest biometric profile;
- the returned media-ID list in the search-session row;
- raw IP addresses, signed URLs, provider keys, Turnstile tokens, or face-vector values in application logs.

The current implementation sends the bounded image directly from Worker memory to the selected provider. It sets `X-Data-Retention: none`, but that header is not a substitute for verifying the provider's actual contract and processing terms.

## Selfie lifetime

1. The browser requires an unchecked, explicit consent checkbox before enabling search.
2. The browser downscales supported images where possible and keeps its preview in an object URL.
3. The Worker validates the exact origin and `X-Find-Me-Consent: true`, applies IP/global rate limits, and reads at most the configured byte limit (6 MiB by default, hard-clamped to 10 MiB).
4. The provider must return exactly one sufficiently clear face and an embedding with the configured dimensions.
5. The query vector is used once against private Vectorize. Candidate vector IDs are joined back through D1, where deleted, rejected, non-approved, or face-disabled media are removed from results.
6. In a `finally` block, the Worker overwrites its selfie byte array and query-vector array. JavaScript runtimes do not promise forensic memory erasure, but the application releases the values and never writes them to durable storage.
7. The browser revokes its preview object URL, clears the selected file controls, resets consent, and drops its Blob reference when the request completes, fails, is cancelled, or the page unmounts.

The D1 search-session row contains only a random ID and timestamps and expires after 10 minutes by default. Scheduled cleanup removes expired rows.

## Wedding-media face embeddings

Wedding-photo embeddings are derived only when all of these are true:

- global AI and Find Me controls permit processing;
- the individual media row has `face_search_enabled=1`;
- the photo is eligible under the current moderation state;
- a production provider and matching private `FACE_INDEX` binding exist.

The indexing pipeline checks the global and per-media switches before provider access, before persistence, and after persistence. If a disable action races an in-flight job, the pipeline purges the newly written vectors. Videos are not face-indexed in this version.

Changing a face model, version, dimensions, or distance metric requires a new Vectorize index or a full purge and re-index. Incompatible vectors must never be mixed.

## Captions, categories, and semantic search

Workers AI receives the private display derivative, not an R2 public URL. Its structured response is schema-validated, length-limited, filtered for sensitive-attribute language, and mapped only onto the controlled category taxonomy. Generated captions are presented as descriptive accessibility/search metadata, not factual identity claims. An administrator can add categories, remove an assignment, or suppress an AI category so that reprocessing does not restore it.

Semantic search embeds the sanitized caption/category text with the configured text-embedding model. Its private vector metadata contains opaque media/event/version identifiers only. Search candidates are always revalidated against D1's public-gallery predicate before being returned.

## Deletion and privacy controls

- Rejecting or deleting media removes it from public and Find Me queries immediately and enqueues asynchronous AI cleanup.
- Per-photo “Exclude from Find Me” purges/ignores that photo's face vectors without removing it from the ordinary gallery.
- The global Find Me switch makes `/find-me` unavailable immediately. Existing vectors remain private and unused until explicitly purged.
- “Purge face index” requires the exact confirmation phrase and queues deletion of every face vector and D1 face reference. Ordinary media, categories, captions, and semantic vectors remain.
- The maintenance command also turns Find Me off before enqueueing the purge:

  ```bash
  npm run ai:purge-faces -- --confirm "PURGE FACE INDEX"
  ```

  It requires `MAINTENANCE_API_URL=https://gallery-api.aleemxnurul.love` and `MAINTENANCE_TOKEN` in the command environment, with the same token stored as a Worker secret. Purging is irreversible; enabling Find Me again requires re-indexing and an active compatible calibration.

If the face index binding is removed while face rows still exist, cleanup fails closed rather than deleting only the D1 references and orphaning unknown vectors. Restore the binding, complete the purge, then remove the resource.

## Archive exclusions

Final archives include original media, original filenames, event/timestamp/media metadata, moderation status at snapshot time, guest names/messages, AI captions, and categories. They intentionally exclude face vectors, bounding boxes, face-quality scores, selfie bytes, query vectors, search results, search-session IDs, raw IP data, rate-limit rows, session data, audit secrets, provider credentials, and signed URLs.

Pending and rejected original media are included in the private operator archive so it is a complete wedding record. Deleted/deleting/expired media is excluded. If source media is deleted after an archive completes, downloads for that archive are disabled and a replacement snapshot must be built. Existing ZIP bytes are not automatically erased from R2; removal is a separate, deliberate operator action after retention decisions are confirmed.

## Administrator checklist before enabling Find Me

1. Record the provider's legal entity, region, subprocessors, retention/training terms, deletion path, incident contact, model name/version, output dimensions, recommended metric, and documented score range.
2. Confirm the endpoint accepts transient processing and that `X-Data-Retention: none` is contractually meaningful for it.
3. Create a new private Vectorize index with exactly those dimensions and metric, then add the `FACE_INDEX` binding.
4. Store the endpoint key as a Worker secret; never use a `VITE_` variable.
5. Test representative same-person and different-person pairs in `/admin/ai/face-calibration`. Save threshold rationale and activate the exact tuple.
6. Backfill a small approved sample, manually inspect false positives/negatives, then expand gradually.
7. Enable Find Me last. Verify the consent, unavailable, no-face, multiple-face, weak-match, deletion, per-photo exclusion, global disable, and purge flows on production-like data.
