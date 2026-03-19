# Design Guidelines: Citing (Bulk Citations)
*Aesthetic: Modern, Professional, High-Density-Rich-Aesthetics.*

### Base Component System
- **UI Architecture**: TailwindCSS + Radix UI + Framer Motion.
- **Typography**: Inter / Outfit for high readability in academic context.
- **Spacing**: Consistent 4, 8, 16, 24, 32px based on 4px grid.

### Interaction States
- **Hover**: Subtle translate-y-[-1px] or scale-[1.01] for interactive cards.
- **Buttons**:
  - `LoadingButton`: Transition to spinner during async (e.g., fetching citation metadata).
  - `Wrong?` button: Subtle red-600 border on focus; opens a centered dialog.
- **Badges**:
  - `Confidence`: Green (>80), Yellow (60-80), Red (<60).
  - `Style`: Secondary badge with blue-600 background.
- **Toast**: Bottom-right placement with 3s self-dismissal.

### Loading-State Pattern
- **Empty States**: Never show a blank white page. Use Skeleton loaders for `AdminReportQueue` rows or "No reports found" centered illustrations.
- **Conversion Phase**: Progress bar or pulse animation during pipeline execution.

### Error Handling
- **Double-Submit Prevention**: Disable submit button on `ReportButton` modal immediately upon click.
- **Dead-Feeling UI**: Use Framer Motion `AnimatePresence` for lists (e.g., reports being removed from queue). 
- **Error Toasts**: Clear, non-technical human error messages (e.g., "Rate limit reached. Please try again tomorrow").
