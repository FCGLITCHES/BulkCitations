# Codex Rules Reference

This file is the authoritative bundled rule set for the `codex-rules` skill.

Review these rules one by one for any coding task. Apply only the rules that materially affect the current task, but do not skip a relevant rule because the request looks narrow.

## 1. Verification And Honesty

- Never claim that a task is complete, supported, or production-ready unless the relevant files, code paths, or environment state have been checked directly.
- Never assume capabilities, data, configuration, or tool availability when the repository or runtime can confirm them.
- If something cannot be done reliably in the current environment, state that plainly and do not fake completion or quality.
- Prefer checking source files, manifests, scripts, database state, and runtime behavior before making implementation claims.
- When a constraint or limitation is discovered, communicate it clearly and keep the solution within what has been verified as possible.

## 2. Regression Rule

If an issue appears in any batch-specific citation set, do not validate the fix only against the one failing batch.

- Rerun the other real-life batch suites for the same engine path.
- Add batch regressions as permanent tests instead of keeping them as one-off local repros.
- Prefer real published citations over synthetic placeholders when expanding positive or mixed-behavior batch suites.

This rule exists to keep the engine consistently accurate across batches instead of improving one sample locally while weakening others.

## 3. Rerun Scope

The rerun scope must follow the ownership of the stage being changed, not only the batch that exposed the problem.

- Changes to shared pipeline stages such as `normalize`, `validate`, `score`, `render`, shared extractor utilities, or shared repair helpers require a full cross-suite rerun of the real-world batch corpuses.
- Changes to `split` and other raw-text chunking logic require rerunning the `raw_unstructured` and pasted-text real-world batch suites, plus numbered, multiline, and PDF-copy stress suites that exercise the same boundaries.
- Changes to ingest adapters or source-specific loaders require rerunning the suites for that ingest path as well as downstream real-world batches that depend on those normalized inputs.
- Changes to threshold constants, scorer weights, opener thresholds, repair-confidence cutoffs, or similar tuning values are treated like shared-stage logic changes and require a full cross-suite rerun.
- If scope is ambiguous, default to the broader rerun.

## 4. Regression Entry Standard

When a failing batch case becomes a permanent regression, the fixture must be self-describing.

Each permanent regression entry should carry:

- the verbatim input citation or batch block
- the expected canonical or rendered outcome that must remain stable
- the motivating failure mode, such as `numbered_batch_clumping`, `pdf_copy_split_token_artifact`, or `website_author_false_positive`
- the fixing commit, PR, or another stable provenance marker when available

Negative tests are the one place synthetic fixtures are encouraged.

- Use synthetic negatives when the point is to prove a repair must not fire on safe text such as `A guide` or `T cells`.
- Use real citations for positive and mixed-behavior regressions whenever possible.

## 5. Conflict Resolution

If a fix resolves one batch but breaks another during cross-suite reruns, the fix is not complete.

Required resolution path:

1. Keep the new regression that exposed the conflict.
2. Iterate until both the original batch and the cross-suite batches pass.
3. If that is not possible, record the issue as a deliberate known trade-off with an explicit product decision.

A change is not mergeable while such a conflict remains implicit.

## 6. Add, Don’t Rewrite

Prefer additive changes over full-file rewrites.

- Append new logic, components, tests, and styles to existing files where possible.
- Rewrite a file only when the existing structure fundamentally cannot support the required change.
- If a rewrite is truly necessary, call that out explicitly before doing it.

## 7. Code Style

- Use TypeScript for project code unless there is a verified reason not to.
- Format code with default Prettier behavior.
- Do not add custom formatting overrides unless they are project-critical.
- Omit explicit `return` statements only where the language and current code style already support that cleanly.
- Define variables, props, types, and interfaces explicitly enough that behavior and boundaries are unambiguous.

## 8. Minimize `useEffect`

Avoid `useEffect` when the value can be derived from props, state, or existing computation.

- Derive values inline instead of syncing state with effects.
- Reserve `useEffect` for true side effects such as subscriptions, DOM mutations, timers, or external calls tied to lifecycle.
- Do not add `useMemo` or `useCallback` by default just to pre-optimize; follow the project’s existing React and compiler conventions.

## 9. Use Dynamic Viewport Height

For responsive full-height layouts, use `100dvh` instead of `100vh`.

- Replace `100vh` with `100dvh` in full-height layout containers.
- Treat this as the default global rule for mobile-correct rendering.

## 10. No Overlapping, Duplicate, or Hardcoded Styles

Before finalizing frontend work, audit for redundant or conflicting styling.

- Remove duplicate CSS rules and conflicting class definitions.
- Avoid hardcoded inline styles that shadow global rules unless there is a verified exception.
- Consolidate shared design behavior into global files instead of repeating it in components.

## 11. No `!important`

Do not use `!important` to override styles.

- Define project-level global sources of truth for default backgrounds, buttons, and cards.
- Let overrides happen through natural cascade and composition rather than force.

## 12. Overflow Rules

`overflow-x` clips the y-axis too.

- Never set `overflow-x: hidden` on a parent whose children need to escape vertically, such as close buttons, menus, and tooltips.
- If horizontal overflow must be contained, introduce a dedicated inner wrapper so the outer container preserves vertical escape.

## 13. Fonts

- Do not intentionally use default browser or framework fonts.
- Choose market-appropriate fonts that match the product’s tone and audience.
- Define font choices in global style files when frontend work touches typography.

## 14. Layout Simplicity And Cards

- Do not default to cards for ordinary structure.
- Never nest cards inside cards.
- Use simpler layout primitives like `div`, `section`, and grid or stack containers unless the content genuinely needs an elevated discrete container.
- If nested cards seem necessary, flatten the hierarchy instead.

## 15. No Ambiguity

- Resolve unclear scope, data shapes, interfaces, and behaviors before implementing when the ambiguity is material.
- In planning and architecture discussions, define terms and boundaries explicitly.
- Do not leave critical behaviors implicit when code or documentation can make them clear.

## 16. Repository Conventions Over Local Shortcuts

- Reuse existing project-level abstractions, style files, test fixtures, and patterns instead of introducing one-off local shortcuts.
- When local repository conventions are stronger or more specific than these defaults, follow the repository unless doing so would violate a critical safety or correctness rule.

## 17. Validation After Change

After making code changes:

- verify the result against the relevant rules above
- run the appropriate tests or reruns for the changed blast radius
- call out any remaining trade-offs, exceptions, or unverified areas explicitly
