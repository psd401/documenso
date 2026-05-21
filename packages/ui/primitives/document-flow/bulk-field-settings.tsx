import { useMemo, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';
import { GripVerticalIcon, Maximize2Icon, Minimize2Icon, Trash2Icon, XIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';

import {
  FIELD_META_DEFAULT_VALUES,
  type TFieldMetaSchema,
  type TFieldTextAlignSchema,
  ZFieldMetaSchema,
} from '@documenso/lib/types/field-meta';
import { parseMessageDescriptor } from '@documenso/lib/utils/i18n';

import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../select';
import { Switch } from '../switch';
import type { FieldFormType } from './add-fields';
import { FRIENDLY_FIELD_TYPE } from './types';

/** Field types that expose a text-alignment property. */
const TEXT_ALIGN_FIELD_TYPES: FieldType[] = [
  FieldType.INITIALS,
  FieldType.NAME,
  FieldType.EMAIL,
  FieldType.DATE,
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.CALCULATED,
];

/** Field types that expose required / read-only toggles. */
const TOGGLE_FIELD_TYPES: FieldType[] = [
  FieldType.INITIALS,
  FieldType.NAME,
  FieldType.EMAIL,
  FieldType.DATE,
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.RADIO,
  FieldType.CHECKBOX,
  FieldType.DROPDOWN,
];

/**
 * Field types offered as bulk conversion targets. Mirrors the field-placement
 * toolbar (excludes FREE_SIGNATURE and CALCULATED, which require dedicated
 * setup that does not translate to a sensible bulk default).
 */
const BULK_CONVERTIBLE_FIELD_TYPES: FieldType[] = [
  FieldType.SIGNATURE,
  FieldType.INITIALS,
  FieldType.EMAIL,
  FieldType.NAME,
  FieldType.DATE,
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.RADIO,
  FieldType.CHECKBOX,
  FieldType.DROPDOWN,
];

/**
 * A partial set of shared field properties to apply to every selected field at
 * once. Only the keys that are present are changed; the rest are left as-is.
 */
export type BulkFieldSettingsValue = {
  type?: FieldType;
  fontSize?: number;
  textAlign?: TFieldTextAlignSchema;
  required?: boolean;
  readOnly?: boolean;
};

/**
 * Applies a bulk settings update to a single field, returning a new field.
 *
 * The field's meta is rebuilt as a plain object and validated through
 * `ZFieldMetaSchema` so the result is correctly narrowed to the discriminated
 * meta union. When the field type changes, the new type's defaults are used as
 * the base and the shared properties (font size, alignment, required/read-only)
 * are carried over where the new type still supports them.
 */
export const applyBulkSettingsToField = <
  T extends { type: FieldType; fieldMeta?: TFieldMetaSchema },
>(
  field: T,
  update: BulkFieldSettingsValue,
): T => {
  const nextType = update.type ?? field.type;
  const typeChanged = nextType !== field.type;

  const currentMeta = field.fieldMeta as Record<string, unknown> | undefined;
  const defaults = FIELD_META_DEFAULT_VALUES[nextType] as Record<string, unknown> | undefined;

  let candidate: Record<string, unknown> | undefined;

  if (typeChanged) {
    // Start from the new type's defaults, carrying over the shared properties
    // from the previous meta where the new type still supports them.
    candidate = defaults ? { ...defaults } : undefined;

    if (candidate && currentMeta) {
      if (currentMeta.fontSize !== undefined) {
        candidate.fontSize = currentMeta.fontSize;
      }
      if (currentMeta.textAlign !== undefined && TEXT_ALIGN_FIELD_TYPES.includes(nextType)) {
        candidate.textAlign = currentMeta.textAlign;
      }
      if (currentMeta.required !== undefined && TOGGLE_FIELD_TYPES.includes(nextType)) {
        candidate.required = currentMeta.required;
      }
      if (currentMeta.readOnly !== undefined && TOGGLE_FIELD_TYPES.includes(nextType)) {
        candidate.readOnly = currentMeta.readOnly;
      }
    }
  } else {
    candidate = currentMeta ? { ...currentMeta } : defaults ? { ...defaults } : undefined;
  }

  if (candidate) {
    if (update.fontSize !== undefined) {
      candidate.fontSize = update.fontSize;
    }
    if (update.textAlign !== undefined && TEXT_ALIGN_FIELD_TYPES.includes(nextType)) {
      candidate.textAlign = update.textAlign;
    }
    if (update.required !== undefined && TOGGLE_FIELD_TYPES.includes(nextType)) {
      candidate.required = update.required;
    }
    if (update.readOnly !== undefined && TOGGLE_FIELD_TYPES.includes(nextType)) {
      candidate.readOnly = update.readOnly;
    }
  }

  const fieldMeta: TFieldMetaSchema = candidate ? ZFieldMetaSchema.parse(candidate) : undefined;

  return {
    ...field,
    type: nextType,
    fieldMeta,
  } as T;
};

/**
 * Returns the single value shared by every entry, or `undefined` when the
 * values differ (i.e. the property is "mixed" across the selection).
 */
const getCommonValue = <V,>(values: V[]): V | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  const [first] = values;

  return values.every((value) => value === first) ? first : undefined;
};

const PANEL_WIDTH = 320;

const getDefaultPanelPosition = () => {
  if (typeof window === 'undefined') {
    return { x: 24, y: 112 };
  }

  return {
    x: Math.max(24, window.innerWidth - PANEL_WIDTH - 32),
    y: 112,
  };
};

export type BulkFieldSettingsProps = {
  /** The currently-selected fields the panel edits. */
  fields: FieldFormType[];
  /** Applies a shared-property change to every selected field. */
  onApply: (_update: BulkFieldSettingsValue) => void;
  /** Clears the current selection (dismisses the panel). */
  onClearSelection: () => void;
  /** Deletes every selected field. */
  onDeleteSelected: () => void;
};

/**
 * Floating panel shown when multiple fields are selected, letting the user edit
 * shared properties (type, font size, alignment, required/read-only) across the
 * whole selection at once.
 */
export const BulkFieldSettings = ({
  fields,
  onApply,
  onClearSelection,
  onDeleteSelected,
}: BulkFieldSettingsProps) => {
  const { _ } = useLingui();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [defaultPanelPosition] = useState(getDefaultPanelPosition);

  const commonType = useMemo(
    () => getCommonValue(fields.map((field) => field.type)),
    [fields],
  );

  const commonFontSize = useMemo(
    () =>
      getCommonValue(
        fields
          .map((field) =>
            field.fieldMeta && 'fontSize' in field.fieldMeta ? field.fieldMeta.fontSize : undefined,
          )
          .filter((value): value is number => typeof value === 'number'),
      ),
    [fields],
  );

  const textAlignFields = useMemo(
    () => fields.filter((field) => TEXT_ALIGN_FIELD_TYPES.includes(field.type)),
    [fields],
  );

  const commonTextAlign = useMemo(
    () =>
      getCommonValue(
        textAlignFields
          .map((field) =>
            field.fieldMeta && 'textAlign' in field.fieldMeta ? field.fieldMeta.textAlign : undefined,
          )
          .filter((value): value is TFieldTextAlignSchema => Boolean(value)),
      ),
    [textAlignFields],
  );

  const toggleFields = useMemo(
    () => fields.filter((field) => TOGGLE_FIELD_TYPES.includes(field.type)),
    [fields],
  );

  const commonRequired = useMemo(
    () =>
      getCommonValue(
        toggleFields.map((field) =>
          field.fieldMeta && 'required' in field.fieldMeta
            ? Boolean(field.fieldMeta.required)
            : false,
        ),
      ),
    [toggleFields],
  );

  const commonReadOnly = useMemo(
    () =>
      getCommonValue(
        toggleFields.map((field) =>
          field.fieldMeta && 'readOnly' in field.fieldMeta
            ? Boolean(field.fieldMeta.readOnly)
            : false,
        ),
      ),
    [toggleFields],
  );

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <Rnd
        default={{ ...defaultPanelPosition, width: PANEL_WIDTH, height: 'auto' }}
        bounds="parent"
        dragHandleClassName="bulk-field-settings-drag-handle"
        enableResizing={false}
        className="pointer-events-auto"
      >
        <div
          data-testid="bulk-field-settings-panel"
          style={{ width: PANEL_WIDTH }}
          className="flex max-h-[80vh] flex-col overflow-hidden rounded-xl border border-border bg-widget shadow-2xl dark:bg-background"
        >
          <div className="bulk-field-settings-drag-handle flex cursor-move items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <GripVerticalIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-semibold text-foreground">
                <Trans>{fields.length} fields selected</Trans>
              </span>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                title={isCollapsed ? _(msg`Expand`) : _(msg`Minimize`)}
                aria-label={isCollapsed ? _(msg`Expand`) : _(msg`Minimize`)}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                onClick={() => setIsCollapsed((prev) => !prev)}
              >
                {isCollapsed ? (
                  <Maximize2Icon className="h-4 w-4" />
                ) : (
                  <Minimize2Icon className="h-4 w-4" />
                )}
              </button>

              <button
                type="button"
                title={_(msg`Clear selection`)}
                aria-label={_(msg`Clear selection`)}
                data-testid="bulk-field-settings-close"
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                onClick={onClearSelection}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!isCollapsed && (
            <>
              <div className="custom-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  <Trans>Changes apply to all selected fields at once.</Trans>
                </p>

                <div>
                  <Label>
                    <Trans>Field type</Trans>
                  </Label>
                  <Select
                    value={commonType ?? ''}
                    onValueChange={(value) => onApply({ type: value as FieldType })}
                  >
                    <SelectTrigger className="bg-background mt-2" data-testid="bulk-field-type">
                      <SelectValue placeholder={_(msg`Mixed`)} />
                    </SelectTrigger>

                    <SelectContent>
                      {BULK_CONVERTIBLE_FIELD_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {parseMessageDescriptor(_, FRIENDLY_FIELD_TYPE[type])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>
                    <Trans>Font size</Trans>
                  </Label>
                  <Input
                    type="number"
                    min={8}
                    max={96}
                    className="bg-background mt-2"
                    placeholder={_(msg`Mixed`)}
                    value={commonFontSize ?? ''}
                    data-testid="bulk-field-font-size"
                    onChange={(e) => {
                      const parsed = Number(e.target.value);

                      if (!Number.isNaN(parsed)) {
                        onApply({ fontSize: parsed });
                      }
                    }}
                  />
                </div>

                {textAlignFields.length > 0 && (
                  <div>
                    <Label>
                      <Trans>Text align</Trans>
                    </Label>
                    <Select
                      value={commonTextAlign ?? ''}
                      onValueChange={(value) =>
                        onApply({ textAlign: value as TFieldTextAlignSchema })
                      }
                    >
                      <SelectTrigger className="bg-background mt-2" data-testid="bulk-field-text-align">
                        <SelectValue placeholder={_(msg`Mixed`)} />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="left">
                          <Trans>Left</Trans>
                        </SelectItem>
                        <SelectItem value="center">
                          <Trans>Center</Trans>
                        </SelectItem>
                        <SelectItem value="right">
                          <Trans>Right</Trans>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {textAlignFields.length < fields.length && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <Trans>Applies to the {textAlignFields.length} compatible fields.</Trans>
                      </p>
                    )}
                  </div>
                )}

                {toggleFields.length > 0 && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-row items-center gap-2">
                      <Switch
                        className="bg-background"
                        checked={commonRequired ?? false}
                        data-testid="bulk-field-required"
                        onCheckedChange={(checked) => onApply({ required: checked })}
                      />
                      <Label>
                        <Trans>Required field</Trans>
                      </Label>
                      {commonRequired === undefined && (
                        <span className="text-xs text-muted-foreground">
                          (<Trans>Mixed</Trans>)
                        </span>
                      )}
                    </div>

                    <div className="flex flex-row items-center gap-2">
                      <Switch
                        className="bg-background"
                        checked={commonReadOnly ?? false}
                        data-testid="bulk-field-read-only"
                        onCheckedChange={(checked) => onApply({ readOnly: checked })}
                      />
                      <Label>
                        <Trans>Read only</Trans>
                      </Label>
                      {commonReadOnly === undefined && (
                        <span className="text-xs text-muted-foreground">
                          (<Trans>Mixed</Trans>)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  data-testid="bulk-field-delete"
                  onClick={onDeleteSelected}
                >
                  <Trash2Icon className="mr-2 h-4 w-4" />
                  <Trans>Delete selected</Trans>
                </Button>

                <Button type="button" variant="outline" size="sm" onClick={onClearSelection}>
                  <Trans>Done</Trans>
                </Button>
              </div>
            </>
          )}
        </div>
      </Rnd>
    </div>,
    document.body,
  );
};
