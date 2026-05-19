import { useMemo, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';
import { CopyPlus, Trash, X } from 'lucide-react';

import {
  DEFAULT_FIELD_FONT_SIZE,
  type TFieldMetaSchema as FieldMeta,
  type TFieldTextAlignSchema,
} from '@documenso/lib/types/field-meta';

import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Switch } from '../switch';
import type { FieldFormType } from './add-fields';

/**
 * Field types whose meta carries a `textAlign` property.
 */
const TEXT_ALIGN_FIELD_TYPES: FieldType[] = [
  FieldType.INITIALS,
  FieldType.NAME,
  FieldType.EMAIL,
  FieldType.DATE,
  FieldType.TEXT,
  FieldType.NUMBER,
];

/**
 * Field types whose meta carries a `fontSize` property.
 */
const FONT_SIZE_FIELD_TYPES: FieldType[] = [
  FieldType.INITIALS,
  FieldType.NAME,
  FieldType.EMAIL,
  FieldType.DATE,
  FieldType.TEXT,
  FieldType.NUMBER,
];

/**
 * Field types whose meta carries `required` / `readOnly` toggles.
 */
const REQUIRED_READONLY_FIELD_TYPES: FieldType[] = [
  FieldType.TEXT,
  FieldType.NUMBER,
  FieldType.RADIO,
  FieldType.CHECKBOX,
  FieldType.DROPDOWN,
];

const sharedValue = <T,>(values: Array<T | undefined>): T | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  const first = values[0];

  return values.every((value) => value === first) ? first : undefined;
};

export type BulkFieldUpdate = Partial<{
  fontSize: number;
  textAlign: TFieldTextAlignSchema;
  required: boolean;
  readOnly: boolean;
}>;

export type BulkFieldSettingsProps = {
  selectedFields: FieldFormType[];
  onClose: () => void;
  onApply: (_update: BulkFieldUpdate) => void;
  onBulkDelete: () => void;
  onBulkDuplicate: () => void;
};

/**
 * Bulk editor body — rendered inline in the document-flow sidebar when 2+ fields are selected.
 * Lets the user apply shared property changes (alignment, font size, required, readOnly) to
 * every selected field at once.
 *
 * Only fields whose type actually exposes a given property are affected by that property's
 * change — e.g. setting `required` on a mixed selection of TEXT + SIGNATURE only updates the
 * TEXT fields, because SIGNATURE has no `required` meta.
 */
export const BulkFieldSettings = ({
  selectedFields,
  onClose,
  onApply,
  onBulkDelete,
  onBulkDuplicate,
}: BulkFieldSettingsProps) => {
  const supportsFontSize = useMemo(
    () => selectedFields.some((field) => FONT_SIZE_FIELD_TYPES.includes(field.type)),
    [selectedFields],
  );

  const supportsTextAlign = useMemo(
    () => selectedFields.some((field) => TEXT_ALIGN_FIELD_TYPES.includes(field.type)),
    [selectedFields],
  );

  const supportsRequired = useMemo(
    () => selectedFields.some((field) => REQUIRED_READONLY_FIELD_TYPES.includes(field.type)),
    [selectedFields],
  );

  const sharedFontSize = useMemo(() => {
    const eligible = selectedFields.filter((field) => FONT_SIZE_FIELD_TYPES.includes(field.type));

    return sharedValue(
      eligible.map((field) => {
        const meta = field.fieldMeta as FieldMeta | undefined;
        return meta && 'fontSize' in meta ? meta.fontSize : undefined;
      }),
    );
  }, [selectedFields]);

  const sharedAlign = useMemo(() => {
    const eligible = selectedFields.filter((field) => TEXT_ALIGN_FIELD_TYPES.includes(field.type));

    return sharedValue(
      eligible.map((field) => {
        const meta = field.fieldMeta as FieldMeta | undefined;
        return meta && 'textAlign' in meta ? meta.textAlign : undefined;
      }),
    );
  }, [selectedFields]);

  const sharedRequired = useMemo(() => {
    const eligible = selectedFields.filter((field) =>
      REQUIRED_READONLY_FIELD_TYPES.includes(field.type),
    );

    return sharedValue(
      eligible.map((field) => {
        const meta = field.fieldMeta as FieldMeta | undefined;
        return meta && 'required' in meta ? meta.required : undefined;
      }),
    );
  }, [selectedFields]);

  const sharedReadOnly = useMemo(() => {
    const eligible = selectedFields.filter((field) =>
      REQUIRED_READONLY_FIELD_TYPES.includes(field.type),
    );

    return sharedValue(
      eligible.map((field) => {
        const meta = field.fieldMeta as FieldMeta | undefined;
        return meta && 'readOnly' in meta ? meta.readOnly : undefined;
      }),
    );
  }, [selectedFields]);

  const [pendingUpdate, setPendingUpdate] = useState<BulkFieldUpdate>({});

  const effectiveFontSize = pendingUpdate.fontSize ?? sharedFontSize ?? DEFAULT_FIELD_FONT_SIZE;
  const effectiveAlign = pendingUpdate.textAlign ?? sharedAlign ?? 'left';
  const effectiveRequired = pendingUpdate.required ?? sharedRequired ?? false;
  const effectiveReadOnly = pendingUpdate.readOnly ?? sharedReadOnly ?? false;

  return (
    <div
      className="my-2 flex flex-col gap-4 rounded-md border border-blue-500/40 bg-blue-50/40 p-4 dark:bg-blue-950/20"
      data-testid="bulk-field-settings"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          <Trans>{selectedFields.length} fields selected</Trans>
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Clear selection"
          className="h-7 w-7 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {supportsFontSize && (
        <div>
          <Label>
            <Trans>Font Size</Trans>
          </Label>
          <Input
            id="bulk-fontSize"
            type="number"
            min={8}
            max={96}
            className="bg-background mt-2"
            value={effectiveFontSize}
            onChange={(e) => {
              const parsed = Number(e.target.value);

              if (!Number.isNaN(parsed)) {
                setPendingUpdate((prev) => ({ ...prev, fontSize: parsed }));
              }
            }}
          />
          {sharedFontSize === undefined && pendingUpdate.fontSize === undefined && (
            <p className="text-muted-foreground mt-1 text-xs">
              <Trans>Selected fields use different font sizes</Trans>
            </p>
          )}
        </div>
      )}

      {supportsTextAlign && (
        <div>
          <Label>
            <Trans>Text Align</Trans>
          </Label>

          <Select
            value={effectiveAlign}
            onValueChange={(value) => {
              if (!value) {
                return;
              }

              setPendingUpdate((prev) => ({
                ...prev,
                textAlign: value as TFieldTextAlignSchema,
              }));
            }}
          >
            <SelectTrigger className="bg-background mt-2">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="right">Right</SelectItem>
            </SelectContent>
          </Select>
          {sharedAlign === undefined && pendingUpdate.textAlign === undefined && (
            <p className="text-muted-foreground mt-1 text-xs">
              <Trans>Selected fields use different alignments</Trans>
            </p>
          )}
        </div>
      )}

      {supportsRequired && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-row items-center gap-2">
            <Switch
              className="bg-background"
              checked={effectiveRequired}
              onCheckedChange={(checked) =>
                setPendingUpdate((prev) => ({ ...prev, required: checked }))
              }
            />
            <Label>
              <Trans>Required field</Trans>
            </Label>
          </div>
          <div className="flex flex-row items-center gap-2">
            <Switch
              className="bg-background"
              checked={effectiveReadOnly}
              onCheckedChange={(checked) =>
                setPendingUpdate((prev) => ({ ...prev, readOnly: checked }))
              }
            />
            <Label>
              <Trans>Read only</Trans>
            </Label>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-blue-500/30 pt-3">
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={Object.keys(pendingUpdate).length === 0}
          onClick={() => {
            onApply(pendingUpdate);
            setPendingUpdate({});
          }}
        >
          <Trans>Apply to {selectedFields.length} fields</Trans>
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={onBulkDuplicate}
          >
            <CopyPlus className="mr-2 h-4 w-4" />
            <Trans>Duplicate</Trans>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={onBulkDelete}
          >
            <Trash className="mr-2 h-4 w-4" />
            <Trans>Delete</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
};
