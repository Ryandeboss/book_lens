# Cleanup, Word documents and audio

In Review, **Download TXT** and **Download DOCX** export the current edited text,
in capture order. Pages set aside as duplicates are excluded from both formats
and from audio. **Keep this page in document** includes a duplicate again in all
exports. Downloads do not clear the saved draft.

DOCX is a real Word document generated locally as an OOXML ZIP. It preserves
paragraphs, explicit line breaks, Unicode and a page break between photographed
pages. It does not reproduce the original book's typography or embed page images.
No text leaves the browser for TXT or DOCX downloads.

## AI cleanup

The existing cleanup request now asks the model to remove clearly meaningless
standalone letter fragments and clearly identifiable scraps from the neighboring
page at repeated line edges. Legitimate short words, initials, section labels,
names and uncertain boundaries must be preserved. This is contextual cleanup,
not a rule deleting every short line or last word. No extra AI call, OCR pass or
camera analysis is added. Capture timing and detection are unchanged.

Raw OCR is always kept. The existing rewrite/deletion guard still rejects overly
large changes, keeping the original text available. AI can miss artifacts or make
mistakes: inspect the cleaned text and use **Use original OCR** or edit manually
when needed. Existing pages can use **Run AI cleanup again**, then **Use cleaned
text** if manual edits were preserved.

## Create and download MP3

Open **Listen to your document**, then **Create MP3**. After generation, preview
the audio or choose **Download MP3**. The audio uses the text currently shown in
the editors, not hidden raw OCR. Generation uses a snapshot; editing, deleting,
restoring a duplicate, or completing more OCR cancels/discards outdated audio.
Leaving Review or pressing **Cancel audio** also cancels it. TXT/DOCX remain
available while audio runs. No audio request is made just by opening Review.

Text is split at natural boundaries into at most 4,500 UTF-8 bytes per request.
The browser sends parts sequentially to `POST /api/speech` with `{ "text": "..." }`.
Express uses Google's official `google-auth-library` and ADC to call the standard
`v1/text:synthesize` REST API with MP3 output at 24 kHz. The browser validates and
joins the constant-bit-rate MPEG audio frames into one file, stripping per-part
ID3/duration metadata. There may be a small pause at a section boundary. Voices
that produce incompatible/variable-bit-rate output are rejected rather than
producing a broken download; the default Standard voice is intended for this path.

Limits: 100,000 UTF-8 bytes of text per export, 64 MiB final audio, two active
speech calls per server, 60 requests/minute per server by default. Each part has
a 45-second backend timeout and a 65-second browser timeout. There are no automatic
paid retries. A failed/cancelled export does not download a partial document;
trying again regenerates it and can incur charges for already generated parts.
Cancellation cannot undo a charge for an upstream call already processed.

## Render setup

1. Enable **Cloud Text-to-Speech API** in the Google project used by your existing
   backend service account and confirm billing is active (you have enabled the API).
2. Keep the existing Render Secret File and
   `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-service-account.json`.
   Keep `GOOGLE_CLOUD_PROJECT_ID` set to that project. No new frontend key is needed.
3. Optional Render environment variables (these are already the code defaults):

   ```env
   TTS_LANGUAGE_CODE=en-US
   TTS_VOICE_NAME=en-US-Standard-C
   TTS_TIMEOUT_MS=45000
   TTS_REQUESTS_PER_MINUTE=60
   ```

4. Deploy the backend and frontend. In Review, try one short corrected page using
   **Create MP3**, play it, and download it. For another language, configure a
   matching Google Standard voice and language code together on Render.

`GET /api/speech/status` reports configuration, language and the part-size limit;
it does not validate Google permissions or make a billed request. A 401/403 during
generation means checking the API in the credential/quota project, service-account
access and billing. Follow the specific Google Console permission diagnostic;
do not grant broad Owner access just for speech. 429 indicates quota/rate limits;
timeouts/unavailability preserve the scan and allow a later retry.

Local development uses the same ADC mechanism as OCR and stays usable without
Google configuration. All credentials remain server-side. Only text is sent to
Render/Google for audio; no page image is needed. Audio responses have `no-store`;
BookLens writes neither text nor audio to server disk, Supabase or cloud storage.
Generated audio exists only in browser memory until downloaded or released.

Speech usage is billed according to Google's selected voice and character usage.
Check the project's quotas, billing and current [Google TTS pricing](https://cloud.google.com/text-to-speech/pricing)
before large exports. See [quotas](https://cloud.google.com/text-to-speech/quotas),
[authentication](https://cloud.google.com/text-to-speech/docs/authentication) and
[audio configuration](https://cloud.google.com/text-to-speech/docs/reference/rest/v1/AudioConfig).
This unauthenticated prototype applies server-wide limits; these are not a billing
cap. Google budget alerts/quotas should be configured in the Console.
