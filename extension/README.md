# BulkCitations Capture (Chrome Extension)

Collect references from any page and open them in BulkCitations in one batch.

## Setup

1. **Build and run the site** (dev): `npm run dev` — site runs at `http://localhost:5000`.
2. **Load the extension** (unpacked):
   - Open Chrome → `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `extension` folder in this repo.

## Usage

1. Select reference text on any webpage → right-click → **Add to CitationConverter**.
2. Repeat to collect more (each capture is appended; enable "Dedupe on capture" in the popup to skip duplicates).
3. Click the extension icon → **Open in CitationConverter** to open the site with the batch prefilled.
4. Review and click **Convert** on the site.

## Config

- **SITE_URL** in `background.js` defaults to `http://localhost:5000`. Change it for production (e.g. your Vercel URL) before packaging.
