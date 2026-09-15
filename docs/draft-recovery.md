# Active scan recovery

BookLens automatically saves the active scan in IndexedDB on the same browser,
device and website origin. Pinia remains the live state. No account or Supabase
storage is involved.

- After refresh or browser restart, choose **Resume scan** in the **Resume
  previous scan?** prompt. Recovery opens Review; use Scan Another Page and
  Start Camera to continue photographing. The camera never starts automatically.
- **Discard draft** deletes the previous scan and its photos. **Start New Scan**
  and **Finish scan** in Review also clear it after confirmation. Download TXT
  before finishing if you want to keep the document.
- Camera **Done** means photographing is done: it opens Review and retains the
  unfinished draft. A TXT download alone does not clear it.
- Drafts expire 24 hours after their last autosave. Expired data is deleted on
  the next visit, or by an expiry timer while BookLens is open. A closed browser
  cannot run deletion or OCR in the background.

Autosaves are debounced by 400ms, with a maximum two-second wait during continuous
changes. Hiding or leaving the tab requests an immediate flush. The interface
reports saving/saved status and storage failures. Abrupt browser termination can
still lose the most recent unsaved changes. Browser storage may be unavailable,
evicted or cleared; TXT remains the permanent export.

Recovery preserves page IDs and capture positions, raw OCR, corrections, manual
edits, provider/confidence/paragraphs/languages, duplicate exclusions/overrides and
the AI cleanup preference. Deleting a page does not reset the capture sequence.

Photos are saved only while they need OCR or are in the existing retry cache.
The queue retains its 30-image/48 MiB pending limit and two-image/12 MiB retry
limit. Completed OCR drops the stored image; cleanup can continue from text.
Metadata and required images commit in one transaction, and an unchanged photo
is not rewritten on every edit. No base64 image strings or visual fingerprints
are included in the metadata.

On resume, queued/in-progress photos rejoin the queue under their original IDs.
Failed photos remain available to Retry within the cache limits. A missing photo
is reported as a rescan error without losing other pages. If OCR was already
saved but cleanup was interrupted, text and edits are restored immediately;
cleanup can be requested again from Review. If the browser closed before an OCR
response was saved, retrying that photo can make another paid OCR call.

Use one active tab for scanning. Revision checks stop a stale tab overwriting
or reviving another tab's saved/cleared draft and show a warning. Text still open
in the stale tab can be downloaded. Recovery data is local browser storage,
available to anyone with access to that browser profile; it is not encrypted by
BookLens or synced between devices.
