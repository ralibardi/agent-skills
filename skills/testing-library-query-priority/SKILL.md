---
name: testing-library-query-priority
description: Guidelines for prioritizing queries in Testing Library to ensure tests reflect user interactions and accessibility best practices.
---

# Testing Library query priority

Tests should mirror [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles): interact with the UI the way users (and assistive tech) do. Prefer queries that are **accessible to everyone** before semantic fallbacks, and reserve **test IDs** for cases where role/text/label matching is impossible or misleading.

**Canonical source:** [About queries — Priority](https://testing-library.com/docs/queries/about/#priority)

## Priority order (highest first)

### Accessible to everyone

1. **`getByRole` / `findByRole` / `queryByRole`** — Prefer for almost everything exposed in the [accessibility tree](https://developer.mozilla.org/en-US/docs/Glossary/AOM). Use the `name` option (accessible name) to disambiguate, e.g. `getByRole('button', { name: /submit/i })`. If a role query is awkward, the UI may be hard to use with assistive tech; consider fixing the component.
2. **`getByLabelText`** — First choice for form controls associated with a `<label>` (matches how users complete forms).
3. **`getByPlaceholderText`** — Only when there is no proper label; [placeholders are not substitutes for labels](https://www.nngroup.com/articles/form-design-placeholders/).
4. **`getByText`** — For non-interactive content (divs, spans, paragraphs) where visible text is the main affordance.
5. **`getByDisplayValue`** — When asserting against the current value of a filled form field.

### Semantic HTML / ARIA attributes

6. **`getByAltText`** — For elements that support `alt` (`img`, `area`, `input type="image"`, etc.).
7. **`getByTitle`** — Last among semantics; `title` is inconsistently exposed to screen readers and often invisible to sighted users.

### Test IDs

8. **`getByTestId`** — Users do not see or hear these. Use when you cannot match by role, label, or text, or when visible text is unstable (e.g. highly dynamic) and fixing the UI is not practical.

## Query variant: get vs query vs find

| Variant    | 0 matches | Async retry | Typical use                          |
| ---------- | --------- | ----------- | ------------------------------------ |
| `getBy*`   | throws    | no          | Element should exist now             |
| `queryBy*` | `null`    | no          | Assert absence                       |
| `findBy*`  | throws    | yes         | Element appears after async update   |

Use `screen.*` from `@testing-library/react` (or your framework wrapper) so queries target `document.body` consistently.

## Practices that pair with this priority

- **Avoid `container.querySelector` / class / id** for assertions unless there is a documented escape hatch; they encode implementation detail, not user-visible behavior. If you must bypass queries, `getByTestId` makes the exception explicit.
- **E2E (e.g. Playwright)** uses different locator strategies; this priority applies to **Testing Library**-style tests, not as a drop-in order for every browser automation API.
- **Accessibility and security:** Stronger reliance on roles and labels tends to keep tests aligned with perceivable, operable UI - useful signal when hardening forms and interactive surfaces, but it does not replace threat modeling or auth checks.

## Quick examples

```tsx
// Prefer role + accessible name
screen.getByRole("button", { name: /save changes/i })

// Forms: label association
screen.getByLabelText(/email address/i)

// Assert something is not shown
expect(screen.queryByText(/error/i)).not.toBeInTheDocument()

// After async UI update
await screen.findByRole("status", { name: /saved/i })
```

## Further reading

- [byRole API](https://testing-library.com/docs/queries/byrole)
- [TextMatch options](https://testing-library.com/docs/queries/about/#textmatch) (string, regex, function; `exact`, `normalizer`)
- [Testing Playground](https://testing-playground.com/) and [browser extension](https://chrome.google.com/webstore/detail/testing-playground/hejbmebodbijjdhflfknehhcgaklhano) for suggested queries
---
name: testing-library-query-priority
description: Use when choosing DOM Testing Library or React Testing Library queries in unit or integration tests, when tests feel brittle, when debating test IDs versus roles or labels, or when reviewing test code that uses querySelector or CSS classes for assertions.
---

# Testing Library query priority

Tests should mirror [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles): interact with the UI the way users (and assistive tech) do. Prefer queries that are **accessible to everyone** before semantic fallbacks, and reserve **test IDs** for cases where role/text/label matching is impossible or misleading.

**Canonical source:** [About queries — Priority](https://testing-library.com/docs/queries/about/#priority)

## Priority order (highest first)

### Accessible to everyone

1. **`getByRole` / `findByRole` / `queryByRole`** — Prefer for almost everything exposed in the [accessibility tree](https://developer.mozilla.org/en-US/docs/Glossary/AOM). Use the `name` option (accessible name) to disambiguate, e.g. `getByRole('button', { name: /submit/i }`). If a role query is awkward, the UI may be hard to use with assistive tech; consider fixing the component.
2. **`getByLabelText`** — First choice for form controls associated with a `<label>` (matches how users complete forms).
3. **`getByPlaceholderText`** — Only when there is no proper label; [placeholders are not substitutes for labels](https://www.nngroup.com/articles/form-design-placeholders/).
4. **`getByText`** — For non-interactive content (divs, spans, paragraphs) where visible text is the main affordance.
5. **`getByDisplayValue`** — When asserting against the current value of a filled form field.

### Semantic HTML / ARIA attributes

6. **`getByAltText`** — For elements that support `alt` (`img`, `area`, `input type="image"`, etc.).
7. **`getByTitle`** — Last among semantics; `title` is inconsistently exposed to screen readers and often invisible to sighted users.

### Test IDs

8. **`getByTestId`** — Users do not see or hear these. Use when you cannot match by role, label, or text, or when visible text is unstable (e.g. highly dynamic) and fixing the UI is not practical.

## Query variant: get vs query vs find

| Variant      | 0 matches | Async retry | Typical use                                      |
| ------------ | --------- | ----------- | ------------------------------------------------ |
| `getBy*`     | throws    | no          | Element should exist now                         |
| `queryBy*`   | `null`    | no          | Assert absence                                   |
| `findBy*`    | throws    | yes         | Element appears after async update             |

Use `screen.*` from `@testing-library/react` (or your framework wrapper) so queries target `document.body` consistently.

## Practices that pair with this priority

- **Avoid `container.querySelector` / class / id** for assertions unless there is a documented escape hatch; they encode implementation detail, not user-visible behavior. If you must bypass queries, `getByTestId` makes the exception explicit.
- **E2E (e.g. Playwright)** uses different locator strategies; this priority applies to **Testing Library**-style tests, not as a drop-in order for every browser automation API.
- **Accessibility and security:** Stronger reliance on roles and labels tends to keep tests aligned with perceivable, operable UI—useful signal when hardening forms and interactive surfaces, but it does not replace threat modeling or auth checks.

## Quick examples

```tsx
// Prefer role + accessible name
screen.getByRole('button', { name: /save changes/i });

// Forms: label association
screen.getByLabelText(/email address/i);

// Assert something is not shown
expect(screen.queryByText(/error/i)).not.toBeInTheDocument();

// After async UI update
await screen.findByRole('status', { name: /saved/i });
```

## Further reading

- [byRole API](https://testing-library.com/docs/queries/byrole)
- [TextMatch options](https://testing-library.com/docs/queries/about/#textmatch) (string, regex, function; `exact`, `normalizer`)
- [Testing Playground](https://testing-playground.com/) and [browser extension](https://chrome.google.com/webstore/detail/testing-playground/hejbmebodbijjdhflfknehhcgaklhano) for suggested queries
