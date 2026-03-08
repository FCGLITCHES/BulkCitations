# BulkCitations Capture Extension — Summary

## How it works

1. **Capture**  
   User selects text on any webpage → right‑click → **Add to CitationConverter**. The extension splits the selection into one or more references (using heuristics) and appends each to a local batch stored in `chrome.storage.local`.

2. **Batch in popup**  
   Clicking the extension icon opens a popup that shows:
   - Count of collected references
   - Scrollable list: each item has a 2-line preview (click to expand), **Copy** and **Remove** per item; duplicates are highlighted when “Dedupe on capture” is on
   - **Dedupe on capture** checkbox (optional; when on, duplicate refs are not added and duplicates in the list are highlighted)
   - **Open in CitationConverter** — reuses an existing site tab if one exists (focus and inject), otherwise opens a new tab; injects the batch and clears it on success; shows “Sent” / “Failed to send”
   - **Copy references** — copies the whole batch to the clipboard (each ref separated by a blank line); button disables and shows “Copied!” or “Copy failed”
   - **Clear batch** — empties the batch

3. **Site integration**  
   When the user clicks **Open in CitationConverter**:
   - The extension looks for an existing tab with the site URL (`chrome.tabs.query`). If found, it focuses that tab and injects. If not, it opens a new tab.
   - After the tab is ready, a script runs that:
     - Writes the batch array to `localStorage` under `bulkcitations_capture_batch`
     - Dispatches a custom event `bulkcitations-capture-batch`
   - The React app reads that key, fills the reference input with the batch (refs joined with `\n\n`), shows a toast (e.g. “X references captured from browser”), and clears the `localStorage` key. No auto-conversion; user reviews and converts in the app.

---

## Files used

| File | Role |
|------|------|
| **extension/manifest.json** | Manifest V3: permissions (`contextMenus`, `storage`, `scripting`, `activeTab`), host permissions (localhost + https), background service worker, popup action. |
| **extension/background.js** | Service worker: creates context menu, implements `splitIntoReferences()` and dedupe logic, stores/retrieves batch in `chrome.storage.local`, handles `openAndInject` by opening tab + `scripting.executeScript` to set `localStorage` and dispatch event. |
| **extension/popup.html** | Popup UI: title, count, scrollable capture list, dedupe checkbox, Open / Copy / Clear buttons. |
| **extension/popup.js** | Popup logic: load batch from storage, render count and list, wire Open (send message to background), Copy (join batch with `\n\n`, `navigator.clipboard.writeText`), Clear (clear storage and UI). |
| **client (CitationConverter)** | Reads `bulkcitations_capture_batch` from `localStorage` on mount and on `bulkcitations-capture-batch` event; passes `initialCaptureText` to `ReferenceInput`. |
| **client (ReferenceInput)** | Accepts `initialCaptureText` and initializes/updates the textarea when it changes. |

Storage keys: `captureBatch` (array of strings), `dedupeOnCapture` (boolean). Site key: `bulkcitations_capture_batch` (JSON array, temporary).

---

## Changes we made

- **Context menu** “Add to CitationConverter” for selection.
- **Batch storage** in `chrome.storage.local` with optional dedupe (normalize + skip if already in batch).
- **Splitting** (`splitIntoReferences`): double newlines; numbered lines (e.g. `1. `, `2)`); numbered inline (e.g. `1. ref 2. ref`); single newlines when lines look citation-like; when ≥2 years in one block: split on “Surname, I” pattern, then on period+space before “Surname, I”, “Surname Initial(s)”, or “I. Surname”.
- **Popup**: count, scrollable list (~4 items visible), dedupe checkbox, Open / Copy / Clear.
- **Open flow**: new tab → wait for load → `executeScript` to set `localStorage` + dispatch `bulkcitations-capture-batch` → clear extension batch.
- **Copy button**: join batch with `\n\n`, copy to clipboard, show “Copied!” briefly.
- **Site**: read batch on load and on event, toast “X references captured from browser”, pass into `ReferenceInput`.

---

## What’s not working / limitations

1. **Bulk split still unreliable**  
   When many refs are pasted in one block (no blank lines, no numbers, or with odd numbering like `.Gomes` / `2.Gomes` / `3.2022`), the heuristics often fail to split into the correct number of refs. Run‑together formats (e.g. Harvard then Vancouver then MLA in one paragraph) are only partially handled by period+author patterns; edge cases (abbreviations, “In” for conference, different punctuation) still produce wrong splits or a single blob.

2. **No per-item copy**  
   Copy copies the whole batch. There’s no “copy this one reference” from the list.

3. **Site URL is fixed**  
   `SITE_URL` in `background.js` is `http://localhost:5000`. For production you’d need a configurable or build-time URL.

4. **Clipboard in popup**  
   Copy works in the popup (user gesture). If the popup closes before the async `writeText` completes, copy can fail; we don’t surface that error.

5. **No “append to existing tab”**  
   Open always creates a new tab; it doesn’t find an existing BulkCitations tab and append there.

6. **Rare split edge cases**  
   Short refs (< 15 chars), refs without a 19xx/20xx year, or refs that don’t match “Surname, I” / “Surname Initial” / “I. Surname” may not split correctly and can be merged or split in the wrong place.
