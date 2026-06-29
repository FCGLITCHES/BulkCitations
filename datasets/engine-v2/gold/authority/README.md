# Authority Gold

Authority data supports deterministic validation and normalization after model
inference.

## Subfolders

- `source/`: reviewed source authority files.
- `generated/`: derived lookup artifacts for runtime use.

Do not use generated authority artifacts as training labels unless the matching
source manifest and generation command are present.
