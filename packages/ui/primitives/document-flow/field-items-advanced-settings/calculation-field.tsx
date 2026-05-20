import { useEffect, useMemo, useRef } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';

import { type TCalculationFieldMeta as CalculationFieldMeta } from '@documenso/lib/types/field-meta';
import {
  detectCircularReferences,
  validateFormulaSyntax,
} from '@documenso/lib/utils/formula';

import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { Label } from '@documenso/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@documenso/ui/primitives/select';
import { Textarea } from '@documenso/ui/primitives/textarea';

/**
 * A minimal description of a sibling field used to populate the reference picker
 * and detect circular references.
 */
export type CalculationFieldSibling = {
  formId: string;
  type: FieldType;
  fieldMeta?: { type?: string; label?: string | null; formula?: string } | null;
};

type CalculationFieldAdvancedSettingsProps = {
  fieldState: CalculationFieldMeta;
  handleFieldChange: (key: keyof CalculationFieldMeta, value: string | number) => void;
  handleErrors: (errors: string[]) => void;
  fields?: CalculationFieldSibling[];
  currentFieldFormId?: string;
};

export const CalculationFieldAdvancedSettings = ({
  fieldState,
  handleFieldChange,
  handleErrors,
  fields = [],
  currentFieldFormId,
}: CalculationFieldAdvancedSettingsProps) => {
  const { t } = useLingui();

  const formulaRef = useRef<HTMLTextAreaElement | null>(null);

  const referenceableFields = useMemo(() => {
    return fields
      .filter(
        (field) =>
          field.formId !== currentFieldFormId &&
          (field.type === FieldType.NUMBER || field.type === FieldType.CALCULATION) &&
          Boolean(field.fieldMeta?.label?.trim()),
      )
      .map((field) => ({
        formId: field.formId,
        label: (field.fieldMeta?.label ?? '').trim(),
      }));
  }, [fields, currentFieldFormId]);

  const availableLabels = useMemo(
    () => referenceableFields.map((field) => field.label),
    [referenceableFields],
  );

  const validationErrors = useMemo(() => {
    const formula = fieldState.formula ?? '';

    if (!formula.trim()) {
      return [];
    }

    const errors = validateFormulaSyntax(formula, availableLabels);

    const currentLabel = (fieldState.label ?? '').trim();

    if (currentLabel) {
      const calculationFields = fields
        .filter((field) => field.type === FieldType.CALCULATION)
        .map((field) => ({
          label:
            field.formId === currentFieldFormId
              ? currentLabel
              : (field.fieldMeta?.label ?? '').trim(),
          formula:
            field.formId === currentFieldFormId ? formula : (field.fieldMeta?.formula ?? ''),
        }))
        .filter((field) => field.label);

      if (detectCircularReferences(calculationFields).includes(currentLabel)) {
        errors.push(t`This formula creates a circular reference.`);
      }
    }

    return errors;
  }, [fieldState.formula, fieldState.label, availableLabels, fields, currentFieldFormId, t]);

  useEffect(() => {
    handleErrors(validationErrors);
  }, [validationErrors]);

  const insertReference = (label: string) => {
    const textarea = formulaRef.current;
    const current = fieldState.formula ?? '';
    const token = `{${label}}`;

    if (textarea) {
      const start = textarea.selectionStart ?? current.length;
      const end = textarea.selectionEnd ?? current.length;

      handleFieldChange('formula', current.slice(0, start) + token + current.slice(end));

      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + token.length;
        textarea.setSelectionRange(cursor, cursor);
      });

      return;
    }

    handleFieldChange('formula', current + token);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>
          <Trans>Label</Trans>
        </Label>
        <Input
          id="label"
          className="bg-background mt-2"
          placeholder={t`Label`}
          value={fieldState.label ?? ''}
          onChange={(event) => handleFieldChange('label', event.target.value)}
        />
      </div>

      <div>
        <Label>
          <Trans>Formula</Trans>
        </Label>
        <Textarea
          ref={formulaRef}
          id="formula"
          className="bg-background mt-2 font-mono text-sm"
          placeholder={t`e.g. {Miles} * {Rate}`}
          rows={3}
          value={fieldState.formula ?? ''}
          onChange={(event) => handleFieldChange('formula', event.target.value)}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          <Trans>
            Reference numeric fields by their label. Supports + - * / ( ) and SUM, ROUND, MIN, MAX.
          </Trans>
        </p>
      </div>

      {referenceableFields.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-foreground/70 text-xs">
            <Trans>Insert field</Trans>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {referenceableFields.map((field) => (
              <Button
                key={field.formId}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => insertReference(field.label)}
              >
                {field.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          <Trans>Add Number fields with labels to reference them in your formula.</Trans>
        </p>
      )}

      {validationErrors.length > 0 && (
        <ul className="list-inside list-disc text-xs text-red-500">
          {validationErrors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      <div>
        <Label>
          <Trans>Decimal places</Trans>
        </Label>
        <Input
          id="precision"
          type="number"
          min={0}
          max={10}
          className="bg-background mt-2"
          placeholder={t`e.g. 2`}
          value={fieldState.precision ?? ''}
          onChange={(event) =>
            handleFieldChange('precision', event.target.value === '' ? '' : Number(event.target.value))
          }
        />
      </div>

      <div>
        <Label>
          <Trans>Font Size</Trans>
        </Label>
        <Input
          id="fontSize"
          type="number"
          className="bg-background mt-2"
          placeholder={t`Field font size`}
          value={fieldState.fontSize ?? 12}
          onChange={(event) => handleFieldChange('fontSize', event.target.value)}
          min={8}
          max={96}
        />
      </div>

      <div>
        <Label>
          <Trans>Text Align</Trans>
        </Label>
        <Select
          value={fieldState.textAlign ?? 'left'}
          onValueChange={(value) => handleFieldChange('textAlign', value)}
        >
          <SelectTrigger className="bg-background mt-2">
            <SelectValue placeholder={t`Select text align`} />
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
      </div>
    </div>
  );
};
