---
description: Streamlined Workflow Logic for this Project
---

# Optimal Workflow Logic for AI Agents and Contributors

To ensure high reliability, consistency, and streamlined operations when making changes to this project, adhere strictly to the following workflow logic.

## 1. Initial Assessment Phase

Before modifying any file, an agent must:
- **Understand the Scope**: Carefully review the user's prompt to identify the exact outcome desired. Analyze whether the request impacts `.client/`, `.server/`, or `.shared/`.
- **Review Existing Context**: Look for relevant Knowledge Items (KIs) or past conversations that may involve the same component or logic to avoid repeating past mistakes.
- **Trace Boundaries**: Determine if the proposed feature crosses stack boundaries (e.g., adding a new backend field that the UI must display).

## 2. Planning Phase

- **Schema First Strategy**: Start at the core. 
  1. Define or modify data shapes in `shared/schema.ts` explicitly. 
  2. Implement backend routes/services (`server/`) utilizing the updated schema. 
  3. Wire the frontend (`client/`) hooks to the backend API.
  4. Finally, update the UI components (`client/src/components/`) to visualize the change.
- **Core Workflow Trace**: Any new feature must respect the primary workflow: paste references → detect formats → extract references into json fields/parse information → confirm format with checks → output plain text/bibtex/pdf/docx.

## 3. Non-Negotiables & Strict Constraints

These are three things agents **must never do** in this repository:
1. **Never change output rules without testing**: Always write or run regression tests before altering any output formatting rules.
2. **Never add new regex/parsing rules without validating**: When adding parsing rules, you must validate against tests to ensure previously proven correct references still pass.
3. **Never put business logic in React components**: The UI should only blindly display what the validation/engine layers dictate. Data manipulation belongs in the backend or shared services.

## 3. Execution Phase

When implementing code changes:
- **Avoid Sweeping Refactors**: Only touch the files necessary for the specific feature unless told otherwise. Modifying unrequested components introduces unnecessary risk.
- **Maintain Small Functional Units**: Implement the code using small, reusable functions rather than bloated components. For example, if citation logic becomes complex, extract it into a small service or utility function.
- **Sequential Tool Calling**: Use proper agentic steps. E.g., read the directory, view the relevant component, replace file content using multi-replace to avoid massive overwrites, then test formatting/linting if possible.

## 4. Verification & Documentation Phase

Before declaring a task complete:
- **Self-Correction & Testing**: Verify that the implemented feature fulfills exactly what the user requested. If any terminal commands (like lint checks, type checks: `npx tsc --noEmit`) can be run, do so to validate your work autonomously.
- **Documentation**: Provide clear inline comments (JSDoc strings) for newly introduced functions, especially tricky algorithms or citation regex mappings. Update any high-level architecture docs if necessary.
- **Final Checks**: Ensure the app builds (e.g., check `build_err.txt` or start a test build) and the user interface visually adheres to premium aesthetics described in the architecture principles.

## 5. Agentic Behavior Guidelines
- **Proactive Validation**: If a backend API is added, automatically verify that the client consumes it accurately without waiting for user commands.
- **Do Not Skip Steps**: Never modify UI elements meant to consume API data without first ensuring the data exists in the schema and the API response.

By following this exact pipeline (Scope -> Schema -> Server -> Client -> Verify -> Doc), errors and regression bugs will remain minimal, and development speed will increase sustainably.
