# TODO: New Member Modal Shows Wrong Waiver (Default Waiver Not Reflected)

## Root Cause
When opening the "+ Add Member" modal, `resetForm()` in `src/components/Members.tsx`
sets the selected waiver template to `waiverTemplates[0]` (the first item in the
array) instead of the template marked as `is_default`. A newly added default waiver
is appended at the end of the array, so the modal shows the wrong waiver.

## Steps
- [x] Members.tsx: In `resetForm()`, select the default waiver template
      (`is_default === true`) instead of `waiverTemplates[0]`, falling back to the
      first template only when no default exists.
- [x] Members.tsx: In `openNewPlanModal()`, also prefer the default waiver template
      when the member has no assigned waiver template (renewal flow consistency).
- [x] Verify no broken references (lint / build) — `tsc --noEmit` passes.
