---
description: Project Architecture Principles
---

# Architecture Principles

This document serves as the reference code architecture for agents working on this project. To ensure high-quality code, all contributors (including AI agents) must strictly follow these principles and the established directory structure.

## 1. System Overview

**Product Scope:** BulkReferences is primarily a website, aided by a browser extension designed to seamlessly streamline users' productivity with minimal friction.
**Core Job:** Takes many mixed-format citations and converts them into one standardized format.
**Primary Users:** Academics, researchers, students, and anyone who publishes literature review papers requiring standardized references.

This application is a full-stack TypeScript project, featuring:
- **Frontend**: React + Vite, located in `client/`.
- **Backend**: Express (Node.js), located in `server/`.
- **Core Engine**: The conversion logic, parser, and formatting engine, located in `server/engine/`.
- **Shared Code**: Zod schemas, types, and core domain logic, located in `shared/`.

## 2. Directory Structure and Boundaries

Strictly maintain the boundaries between the three primary domains:

### `client/` (Frontend)
- **Role**: Handles UI components, styling, API communication, and state management.
- **Constraints**: 
  - Never import from `server/`.
  - Use relative paths within `client/`.
  - Use `@/` alias for `client/src` if configured.
  - Rely on React Query or similar data fetching patterns for communicating with the backend APIs.
  - Component files should be small, focused, and placed in `client/src/components/`. Page-level components go in `client/src/pages/`.

### `server/` (Backend & Engine)
- **Role**: Handles API routes, business logic, storage abstraction, file preprocessing (.txt, .pdf, .docx), and server operations.
- **Constraints**:
  - Never import from `client/`.
  - Routes should be defined in `server/routes.ts` or scoped under `server/routes/`.
  - **Validation Boundary**: The core engine returns raw parsed data, the validation layer grades it (warnings, errors), and the UI blindly displays whatever the validation layer dictates. Keep this strict split!
  - Abstract data access using `storage.ts`.
  - Server logic should validate *all* incoming requests using schemas defined in `shared/`.

### `server/engine/` (Core Engine)
- **Role**: Owns the actual conversion engine. Responsible for pure string manipulation, CSL formatting, and output generation. Preprocessing of file types (e.g. PDF/DOCX extraction) must happen *outside* the engine before strings are passed in.

### `shared/` (Domain/Types)
- **Role**: Defines the source of truth for data structures (Zod schemas), interfaces, and types.
- **Constraints**:
  - Contains no environment-specific logic (e.g., no raw DOM manipulation, no Express-specific response logic).
  - Both `client/` and `server/` consume from `shared/`.

## 3. Design Principles

### Principle 1: Single Source of Truth
- Place data models, types, and validation logic (e.g., Zod schemas) in the `shared/` folder. Both the client and server should rely on the exact same schemas to guarantee consistency.

### Principle 2: Separation of Concerns
- **UI vs Logic**: Keep UI components dumb. Move complex business logic into custom hooks (`client/src/hooks/`) or utility functions (`client/src/lib/`).
- **Route vs Service**: For the backend, keep Express route handlers thin. Delegate business logic, citation processing, and complex formatting to dedicated files in `server/services/`.

### Principle 3: Strict Typing
- Do not use `any` or loose typing. Ensure all function signatures, API responses, and Zod schemas are richly typed.

### Principle 4: Aesthetics & UI Quality
- Use predefined Tailwind utility classes to build consistent interfaces. Create and use reusable UI components (e.g., standard buttons, inputs, dialogs) instead of inline custom styles. Follow a premium design aesthetic (e.g., dark mode compatibility, consistent padding, subtle animations).

## 4. Development Standards
- Maintain clean, descriptive, and deterministic code.
- Provide inline documentation (JSDoc) for complex citation parsing or matching logic so future agents can seamlessly understand the intent.
- Avoid repeating logic. If you find duplicated code styling or validation, extract it into a shared hook or utility function.

*Agents: When assigned a task, verify these boundaries before opening or modifying files. Any new feature must fit neatly into this established structure.*
