## Current Focus Issues

As of `2026-03-23`, these are the highest-value bugs and false-positive sources still worth prioritizing.

### 1. GROBID Runtime Provisioning

- The engine path is wired, but production or local use still depends on `ENABLE_GROBID_EXTRACTOR=true` and a reachable service at `GROBID_URL`.
- Without the sidecar running, the engine cannot actually route into GROBID outside tests.

### 2. Book / Chapter / Conference Boundary Cases

- Real-world tail parsing is much better now, but the remaining hard cases are still container-boundary problems:
- long book titles with subtitles
- translated books with notes between title and publisher
- conference proceedings where `In ...` and publisher segments both appear

### 3. Low-Confidence Stage Blame

- `likelyStageBlame` is a useful review shortcut, but low-confidence reports can still be misattributed.
- The new debug trace should be treated as the source of truth when the stage badge says `uncertain`.

### 4. Historical And Book Provider Recall

- Crossref and related providers still miss some older works, books, and humanities references.
- These are usually scored correctly now, but external verification coverage is still weaker than journal-article coverage.

### 5. OCR And Truncated Input Noise

- Split contamination and malformed extraction are still most fragile on OCR-heavy or truncated inputs.
- This is still the main source of genuine `action_needed` outcomes.

### 6. Analytics Country Coverage

- Country metrics depend on standard host proxy headers.
- Local development and some deployments will show `unknown` until those headers are present.
