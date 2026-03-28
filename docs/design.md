# Design Specification: Citing

**Goal**: High-Density, Premium Academic Aesthetic (Vibrant, Professional, Dynamic).

## Base Component System
- **Framework**: TailwindCSS + Radix UI (via Shadcn).
- **Animation**: Framer Motion for micro-interactions and smooth transitions.
- **Typography**: `Inter` for functional text, `Outfit` for headings and premium accents.
- **Color Palette**: Sleek dark mode by default, HSL-tailored harmonious colors (Deep Indigo, Emerald Green for success, Ruby Red for errors). Use glassmorphism for overlays.
- **Institutional Suite Branding**: Uses the "Digital Archivist" sub-brand with a specialized high-density academic theme featuring `Noto Serif` for primary headlines and an ivory/slate surface palette.
- **Institutional Branding - New Tokens**:
    - `boxShadow.editorial`: `0 4px 24px -4px rgba(25, 28, 30, 0.04)` (for a subtle, premium layered effect on metric cards).
    - `backgroundImage.signature-cta`: A deep blue-to-navy linear gradient (from `#191C1E` to `#001F2A`) for primary action buttons.
    - **Glassmorphism**: 80% opacity with 20px blur for main navigation headers and context overlays.

## Reusable Components
- **CitationCard**: The primary unit for displaying a processed reference. Extends Radix `Card`.
- **ConfidenceBadge**: Dynamic color scaling based on Phase 11 output.
- **LoadingButton**: Standardized button with integrated spinner and "disabled-while-loading" logic.
- **ReportModal**: Centered dialog for user feedback, extending Radix `Dialog`.

## Loading-State Pattern
- **Requirement**: Never show a blank white page or a generic full-screen spinner.
- **Implementation**: 
    - Use **Skeleton Loaders** for lists and grids (e.g., `AdminReportQueue`).
    - Use a **Phased Progress Bar** during conversion that explicitly shows the current engine phase (e.g., "Enriching via Crossref...").
    - Use pulse animations for individual citation cards being processed in a stream.

## Interaction States
Every interactive element MUST support:
- **Hover**: Subtle `translate-y-[-1px]` and `shadow-lg`.
- **Focus**: Clear ring offset with high-contrast color.
- **Active/Pressed**: Slight `scale-[0.98]` to provide tactile feedback.
- **Disabled**: Reduced opacity and `cursor-not-allowed`.

## Spacing & Layout
- **Grid**: 4px base unit.
- **Sections**: 32px or 48px vertical spacing.
- **Component Gap**: 16px (consistent with `gap-4` in Tailwind).
- **Inner Padding**: 12px or 16px for cards and containers.

## Border Radius
- **Professional Standard**: 0.5rem (`8px`). 
- **Primary Containers**: Use `rounded-lg` (mapped to `--radius`).
- **Secondary Elements**: Use `rounded-md` or `rounded-sm` for tighter nesting.

## Notifications (Toasts)
- **Pattern**: Sonner-style toasts.
- **Placement**: Bottom-right on desktop, top-center on mobile.
- **Dismissal**: 4s auto-dismissal; manual swipe to dismiss.
- **Behavior**: Stacked notifications for multiple events (e.g., "5 Citations Deduplicated").

## Async & Double-Submit Prevention
- **Loading Buttons**: Must display a spinner and become `disabled` immediately upon click. Text should change to present-continuous (e.g., "Saving..." instead of "Save").
- **Optimistic UI**: Use for simple actions like "Hide Duplicate".
- **Dead-Feeling UI Prevention**: Use `AnimatePresence` for all list additions/removals. Ensure a minimum animation duration of 200ms to allow the eye to follow changes.
