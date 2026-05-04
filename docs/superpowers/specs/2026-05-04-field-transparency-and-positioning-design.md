# Field Transparency and Per-Item Positioning

**Date:** 2026-05-04
**Status:** Approved
**Triggered by:** User feedback on IHCP (Individualized Health Care Plan) template — field outlines obscure document text, checkbox groups can't align to variable-width form labels.

## Problem

1. Checkbox and radio fields render with `bg-white/90 ring-2` in the signing view, creating a near-opaque white rectangle that hides the document text underneath. On dense forms like the IHCP, this makes parts of the form unreadable.

2. Checkbox/radio groups render items in a flex container with uniform spacing (`gap-1`). On forms where checkbox labels have varying lengths (e.g., "Before breakfast" vs "As Needed ONLY"), the checkboxes can't be aligned to the corresponding document text.

3. There is no way to group independent checkbox/radio fields for cross-field validation (e.g., "select at least 1 from these 5 checkboxes"). This is out of scope for now but we want scaffolding.

## Design

### 1. Field Transparency (Checkbox/Radio Only)

**File:** `packages/ui/components/field/field.tsx` — `FieldRootContainer`

Current classes on the container div (line 140):
```
bg-white/90 ring-2 ring-gray-200 ... [color?.base which adds ring-recipient-green etc.]
```

Change: when `field.type` is `CHECKBOX` or `RADIO`, apply:
```
bg-transparent ring-1
```

Instead of:
```
bg-white/90 ring-2
```

The recipient color class (`ring-recipient-green`, etc.) still applies but the ring needs reduced visual weight. Use `ring-1` (thinner) and modify the `base` style in `generateStyles()` to use the `/40` opacity modifier on the ring (e.g., `ring-recipient-green/40`) for checkbox/radio fields. The `generateStyles` function already uses this pattern for hover states (`bg-recipient-green/30`).

All other field types (SIGNATURE, TEXT, NAME, EMAIL, DATE, NUMBER, DROPDOWN, FREE_SIGNATURE, INITIALS) keep current rendering unchanged.

**Also update:** `FieldContainerPortal` styles and `document-read-only-fields.tsx` if they apply the same background pattern for checkbox/radio.

### 2. Per-Item Positioning

#### Schema Changes

**File:** `packages/lib/types/field-meta.ts`

Extend the value item schema in both `ZRadioFieldMeta` and `ZCheckboxFieldMeta`:

```typescript
values: z.array(
  z.object({
    id: z.number(),
    checked: z.boolean(),
    value: z.string(),
    offsetX: z.number().optional(),  // percentage of page width, relative to field origin
    offsetY: z.number().optional(),  // percentage of page height, relative to field origin
  }),
).optional(),
```

Add `'custom'` to the `direction` enum:

```typescript
direction: z.enum(['vertical', 'horizontal', 'custom']).optional().default('vertical'),
```

#### Editor Changes

**Files:**
- `apps/remix/app/components/forms/editor/editor-field-checkbox-form.tsx`
- `apps/remix/app/components/forms/editor/editor-field-radio-form.tsx`
  (or the shared generic form if these share a component)

Changes:
- Keep existing horizontal/vertical direction toggle
- When direction changes to horizontal/vertical, auto-calculate evenly-spaced offsets for all items and clear any manual offsets
- Add a collapsible "Item Positions" section below the direction toggle
- Each item row shows: item label + X offset input + Y offset input (number inputs, in percentage units matching `positionX`/`positionY` coordinate system)
- When a user manually edits any offset, direction automatically switches to `'custom'`
- Offsets default to `undefined` (no offset = use flex layout fallback)

#### Signing View Changes

**Files:**
- `apps/remix/app/components/general/document-signing/document-signing-checkbox-field.tsx`
- `apps/remix/app/components/general/document-signing/document-signing-radio-field.tsx`

Changes:
- Check if any item in the field's values has `offsetX` or `offsetY` set
- If offsets exist: render items with relative positioning using the offset values, converting from page-percentage to pixels using the same coordinate system as `useFieldPageCoords`
- If no offsets (all undefined): fall back to the current flex layout (`flex-row`/`flex-col` with `gap-1`) — existing fields render identically with no migration needed

#### Read-Only / PDF Flattening

If checkbox/radio field values are flattened into the final PDF (for completed documents), the offset positioning must also apply there. Check `document-read-only-fields.tsx` and any server-side PDF rendering for consistency.

### 3. Scaffolding for Future Field Grouping

No user-facing changes. Structural prep only.

**File:** `packages/lib/types/field-meta.ts`

Add to `ZBaseFieldMeta`:
```typescript
groupId: z.string().optional(),
```

**New file:** `packages/lib/utils/field-group-validation.ts`

Extract/generalize the checkbox validation logic:

```typescript
type FieldGroupValidationRule = '>=' | '=' | '<=';

type FieldGroupValidation = {
  groupId: string;
  rule: FieldGroupValidationRule;
  count: number;
};

function validateFieldGroup(
  selectedCount: number,
  rule: FieldGroupValidationRule,
  requiredCount: number,
): boolean;
```

The existing `validateCheckboxLength` in `packages/lib/advanced-fields-validation/validate-checkbox.ts` should call through to this generic function. The signing view's checkbox validation continues to work identically — it just uses the generalized function under the hood.

The `FieldGroupValidation` type exists for future use when we build cross-field grouping UI. The `groupId` on `ZBaseFieldMeta` is the join key — fields sharing a `groupId` form a validation group.

## Scope Boundaries

**In scope:**
- Transparency change for checkbox/radio in signing view
- Per-item offset schema and editor UI
- Offset-aware rendering in signing view
- Scaffolding types and extracted validation

**Out of scope:**
- Drag-and-drop positioning of individual items on the canvas
- Cross-field grouping UI
- Cross-field validation enforcement
- Changes to non-checkbox/radio field types
- Changes to the template editor canvas (Konva layer)

## Migration

No database migration needed. The schema changes are additive (new optional fields in JSON metadata). Existing fields without offsets or groupId render identically via the flex layout fallback.
