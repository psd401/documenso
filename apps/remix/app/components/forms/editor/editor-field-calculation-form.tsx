import { useEffect, useMemo, useRef } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import {
  DEFAULT_FIELD_FONT_SIZE,
  FIELD_DEFAULT_GENERIC_ALIGN,
  type TCalculationFieldMeta as CalculationFieldMeta,
  ZCalculationFieldMeta,
} from '@documenso/lib/types/field-meta';
import { detectCircularReferences, validateFormulaSyntax } from '@documenso/lib/utils/formula';
import { Alert, AlertDescription } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { Textarea } from '@documenso/ui/primitives/textarea';

import {
  EditorGenericFontSizeField,
  EditorGenericLabelField,
  EditorGenericTextAlignField,
} from './editor-field-generic-field-forms';

const ZCalculationFieldFormSchema = ZCalculationFieldMeta.pick({
  label: true,
  formula: true,
  precision: true,
  fontSize: true,
  textAlign: true,
});

type TCalculationFieldFormSchema = z.infer<typeof ZCalculationFieldFormSchema>;

/**
 * A minimal description of a sibling field used to populate the reference picker
 * and detect circular references.
 */
export type CalculationReferenceField = {
  formId: string;
  type: FieldType;
  fieldMeta?: { type?: string; label?: string | null; formula?: string } | null;
};

type EditorFieldCalculationFormProps = {
  value: CalculationFieldMeta | undefined;
  onValueChange: (value: CalculationFieldMeta) => void;
  /** All fields in the document, used to populate the reference picker and detect cycles. */
  documentFields?: CalculationReferenceField[];
  /** The formId of the calculation field currently being edited. */
  currentFieldFormId?: string;
};

export const EditorFieldCalculationForm = ({
  value = {
    type: 'calculation',
  },
  onValueChange,
  documentFields = [],
  currentFieldFormId,
}: EditorFieldCalculationFormProps) => {
  const { t } = useLingui();

  const formulaRef = useRef<HTMLTextAreaElement | null>(null);

  const form = useForm<TCalculationFieldFormSchema>({
    resolver: zodResolver(ZCalculationFieldFormSchema),
    mode: 'onChange',
    defaultValues: {
      label: value.label || '',
      formula: value.formula || '',
      precision: value.precision ?? 2,
      fontSize: value.fontSize || DEFAULT_FIELD_FONT_SIZE,
      textAlign: value.textAlign ?? FIELD_DEFAULT_GENERIC_ALIGN,
    },
  });

  const { control } = form;

  const formValues = useWatch({ control });

  // Numeric fields (and other formula fields) with a label can be referenced.
  const referenceableFields = useMemo(() => {
    return documentFields
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
  }, [documentFields, currentFieldFormId]);

  const availableLabels = useMemo(
    () => referenceableFields.map((field) => field.label),
    [referenceableFields],
  );

  // Surface syntax errors, unknown references and circular references inline.
  const validationErrors = useMemo(() => {
    const formula = formValues.formula ?? '';

    if (!formula.trim()) {
      return [];
    }

    const errors = validateFormulaSyntax(formula, availableLabels);

    // Build the dependency graph from every formula field, using the in-progress
    // edit for the current field, so cycles are caught as the user types.
    const currentLabel = (formValues.label ?? '').trim();

    if (currentLabel) {
      const calculationFields = documentFields
        .filter((field) => field.type === FieldType.CALCULATION)
        .map((field) => ({
          label:
            field.formId === currentFieldFormId
              ? currentLabel
              : (field.fieldMeta?.label ?? '').trim(),
          formula:
            field.formId === currentFieldFormId
              ? formula
              : (field.fieldMeta?.formula ?? ''),
        }))
        .filter((field) => field.label);

      const cyclic = detectCircularReferences(calculationFields);

      if (cyclic.includes(currentLabel)) {
        errors.push(t`This formula creates a circular reference.`);
      }
    }

    return errors;
  }, [formValues.formula, formValues.label, availableLabels, documentFields, currentFieldFormId, t]);

  const insertReference = (label: string) => {
    const textarea = formulaRef.current;
    const current = form.getValues('formula') ?? '';
    const token = `{${label}}`;

    if (textarea) {
      const start = textarea.selectionStart ?? current.length;
      const end = textarea.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);

      form.setValue('formula', next, { shouldValidate: true, shouldDirty: true });

      // Restore focus and place the cursor after the inserted token.
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + token.length;
        textarea.setSelectionRange(cursor, cursor);
      });

      return;
    }

    form.setValue('formula', current + token, { shouldValidate: true, shouldDirty: true });
  };

  useEffect(() => {
    const validatedFormValues = ZCalculationFieldFormSchema.safeParse(formValues);

    if (validatedFormValues.success && validationErrors.length === 0) {
      onValueChange({
        type: 'calculation',
        ...validatedFormValues.data,
        // Calculation fields are always derived; never editable by signers.
        readOnly: true,
        required: false,
      });
    }
  }, [formValues, validationErrors]);

  return (
    <Form {...form}>
      <form>
        <fieldset className="flex flex-col gap-2">
          <EditorGenericLabelField formControl={form.control} />

          <FormField
            control={form.control}
            name="formula"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Formula</Trans>
                </FormLabel>
                <FormControl>
                  <Textarea
                    data-testid="field-form-formula"
                    className="bg-background font-mono text-sm"
                    placeholder={t`e.g. {Miles} * {Rate}`}
                    rows={3}
                    {...field}
                    ref={(element) => {
                      field.ref(element);
                      formulaRef.current = element;
                    }}
                  />
                </FormControl>
                <FormDescription>
                  <Trans>
                    Reference numeric fields by their label, e.g. <code>{'{Miles}'}</code>. Supports
                    + - * / ( ) and SUM, ROUND, MIN, MAX.
                  </Trans>
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {referenceableFields.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-foreground/70">
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
            <p className="text-xs text-muted-foreground">
              <Trans>
                Add Number fields with labels to reference them in your formula.
              </Trans>
            </p>
          )}

          {validationErrors.length > 0 && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription>
                <ul className="list-inside list-disc text-xs">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <FormField
            control={form.control}
            name="precision"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Decimal places</Trans>
                </FormLabel>
                <FormControl>
                  <Input
                    data-testid="field-form-precision"
                    type="number"
                    min={0}
                    max={10}
                    className="bg-background"
                    placeholder={t`e.g. 2`}
                    {...field}
                    value={field.value ?? ''}
                    onChange={(event) =>
                      field.onChange(event.target.value === '' ? null : Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <EditorGenericFontSizeField formControl={form.control} />

          <EditorGenericTextAlignField formControl={form.control} />
        </fieldset>
      </form>
    </Form>
  );
};
