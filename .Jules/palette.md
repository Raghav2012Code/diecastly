## 2025-05-18 - Disabled Next.js Link Focus Behavior
**Learning:** Next.js `<Link>` elements with `aria-disabled="true"` still receive keyboard focus during tabbing unless `tabIndex={-1}` is explicitly specified.
**Action:** Always add `tabIndex={isDisabled ? -1 : undefined}` whenever rendering disabled link components.
