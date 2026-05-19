import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import type { Field } from '@prisma/client';
import { FieldType, Prisma, RecipientRole, SendStatus } from '@prisma/client';
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Contact,
  Disc,
  Hash,
  Mail,
  Type,
  User,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { useHotkeys } from 'react-hotkeys-hook';

import { getBoundingClientRect } from '@documenso/lib/client-only/get-bounding-client-rect';
import { useAutoSave } from '@documenso/lib/client-only/hooks/use-autosave';
import { useDocumentElement } from '@documenso/lib/client-only/hooks/use-document-element';
import { PDF_VIEWER_PAGE_SELECTOR, getPdfPagesCount } from '@documenso/lib/constants/pdf-viewer';
import {
  type TFieldMetaSchema as FieldMeta,
  ZFieldMetaSchema,
} from '@documenso/lib/types/field-meta';
import type { TRecipientLite } from '@documenso/lib/types/recipient';
import { nanoid } from '@documenso/lib/universal/id';
import { ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING } from '@documenso/lib/utils/advanced-fields-helpers';
import { validateFieldsUninserted } from '@documenso/lib/utils/fields';
import { parseMessageDescriptor } from '@documenso/lib/utils/i18n';
import {
  canRecipientBeModified,
  canRecipientFieldsBeModified,
  getRecipientsWithMissingFields,
} from '@documenso/lib/utils/recipients';

import { FieldToolTip } from '../../components/field/field-tooltip';
import { getRecipientColorStyles } from '../../lib/recipient-colors';
import { cn } from '../../lib/utils';
import { Alert, AlertDescription } from '../alert';
import { Card, CardContent } from '../card';
import { Form } from '../form/form';
import { RecipientSelector } from '../recipient-selector';
import { useStep } from '../stepper';
import { useToast } from '../use-toast';
import { type TAddFieldsFormSchema, ZAddFieldsFormSchema } from './add-fields.types';
import { BulkFieldSettings, type BulkFieldUpdate } from './bulk-field-settings';
import {
  DocumentFlowFormContainerActions,
  DocumentFlowFormContainerContent,
  DocumentFlowFormContainerFooter,
  DocumentFlowFormContainerHeader,
  DocumentFlowFormContainerStep,
} from './document-flow-root';
import { FieldItem, type FieldSelectModifiers } from './field-item';
import { FieldAdvancedSettings } from './field-item-advanced-settings';
import { MissingSignatureFieldDialog } from './missing-signature-field-dialog';
import { type DocumentFlowStep, FRIENDLY_FIELD_TYPE } from './types';

const MIN_HEIGHT_PX = 12;
const MIN_WIDTH_PX = 36;

const DEFAULT_HEIGHT_PX = MIN_HEIGHT_PX * 2.5;
const DEFAULT_WIDTH_PX = MIN_WIDTH_PX * 2.5;

export type FieldFormType = {
  nativeId?: number;
  formId: string;
  pageNumber: number;
  type: FieldType;
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
  signerEmail: string;
  recipientId: number;
  fieldMeta?: FieldMeta;
};

export type AddFieldsFormProps = {
  documentFlow: DocumentFlowStep;
  hideRecipients?: boolean;
  recipients: TRecipientLite[];
  fields: Field[];
  onSubmit: (_data: TAddFieldsFormSchema) => void;
  onAutoSave: (_data: TAddFieldsFormSchema) => Promise<void>;
  canGoBack?: boolean;
  isDocumentPdfLoaded: boolean;
  teamId: number;
};

export const AddFieldsFormPartial = ({
  documentFlow,
  hideRecipients = false,
  recipients,
  fields,
  onSubmit,
  onAutoSave,
  canGoBack = false,
  isDocumentPdfLoaded,
  teamId,
}: AddFieldsFormProps) => {
  const { toast } = useToast();
  const { _ } = useLingui();

  const [isMissingSignatureDialogVisible, setIsMissingSignatureDialogVisible] = useState(false);

  const { isWithinPageBounds, getFieldPosition, getPage } = useDocumentElement();
  const { currentStep, totalSteps, previousStep } = useStep();
  const canRenderBackButtonAsRemove =
    currentStep === 1 && typeof documentFlow.onBackStep === 'function' && canGoBack;
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [currentField, setCurrentField] = useState<FieldFormType>();
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{
    pageNumber: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const isMultiSelectActive = selectedFieldIds.length > 1;

  const clearSelection = useCallback(() => {
    setSelectedFieldIds([]);
  }, []);

  const handleFieldSelect = useCallback((fieldFormId: string, modifiers: FieldSelectModifiers) => {
    const additive = modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey;

    setSelectedFieldIds((prev) => {
      if (additive) {
        if (prev.includes(fieldFormId)) {
          return prev.filter((id) => id !== fieldFormId);
        }

        return [...prev, fieldFormId];
      }

      // Plain click — single-select.
      return [fieldFormId];
    });
  }, []);

  const form = useForm<TAddFieldsFormSchema>({
    defaultValues: {
      fields: fields.map((field) => ({
        nativeId: field.id,
        formId: `${field.id}-${field.envelopeItemId}`,
        pageNumber: field.page,
        type: field.type,
        pageX: Number(field.positionX),
        pageY: Number(field.positionY),
        pageWidth: Number(field.width),
        pageHeight: Number(field.height),
        signerEmail:
          recipients.find((recipient) => recipient.id === field.recipientId)?.email ?? '',
        recipientId: field.recipientId,
        fieldMeta: field.fieldMeta ? ZFieldMetaSchema.parse(field.fieldMeta) : undefined,
      })),
    },
    resolver: zodResolver(ZAddFieldsFormSchema),
  });

  useHotkeys(['ctrl+c', 'meta+c'], (evt) => onFieldCopy(evt));
  useHotkeys(['ctrl+v', 'meta+v'], (evt) => onFieldPaste(evt));
  useHotkeys(['ctrl+d', 'meta+d'], (evt) => onFieldCopy(evt, { duplicate: true }));
  useHotkeys(
    ['escape'],
    () => {
      clearSelection();
    },
    { enableOnFormTags: false },
  );
  useHotkeys(
    ['delete', 'backspace'],
    (evt) => {
      if (selectedFieldIds.length > 1) {
        evt.preventDefault();
        bulkDelete();
      }
    },
    { enableOnFormTags: false },
    [selectedFieldIds],
  );

  const onFormSubmit = form.handleSubmit(onSubmit);

  const handleSavedFieldSettings = (fieldState: FieldMeta) => {
    const initialValues = form.getValues();

    const updatedFields = initialValues.fields.map((field) => {
      if (field.formId === currentField?.formId) {
        const parsedFieldMeta = ZFieldMetaSchema.parse(fieldState);

        return {
          ...field,
          fieldMeta: parsedFieldMeta,
        };
      }

      return field;
    });

    form.setValue('fields', updatedFields);
  };

  const {
    append,
    remove,
    update,
    fields: localFields,
  } = useFieldArray({
    control: form.control,
    name: 'fields',
  });

  const selectedFields = useMemo(
    () => localFields.filter((field) => selectedFieldIds.includes(field.formId)),
    [localFields, selectedFieldIds],
  );

  const applyBulkUpdate = useCallback(
    (update: BulkFieldUpdate) => {
      const initialValues = form.getValues();

      const updatedFields = initialValues.fields.map((field) => {
        if (!selectedFieldIds.includes(field.formId)) {
          return field;
        }

        const existingMeta = field.fieldMeta;

        // Build a meta object scoped to the field's type by merging only properties the
        // field's meta actually accepts.
        const nextMeta: Record<string, unknown> = {
          ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
        };

        // Without a type tag the meta cannot be parsed, so seed it from the field type.
        if (!nextMeta.type) {
          nextMeta.type = field.type.toLowerCase();
        }

        const fontSizeTypes: FieldType[] = [
          FieldType.INITIALS,
          FieldType.NAME,
          FieldType.EMAIL,
          FieldType.DATE,
          FieldType.TEXT,
          FieldType.NUMBER,
        ];
        const textAlignTypes: FieldType[] = fontSizeTypes;
        const requiredReadonlyTypes: FieldType[] = [
          FieldType.TEXT,
          FieldType.NUMBER,
          FieldType.RADIO,
          FieldType.CHECKBOX,
          FieldType.DROPDOWN,
        ];

        if (update.fontSize !== undefined && fontSizeTypes.includes(field.type)) {
          nextMeta.fontSize = update.fontSize;
        }

        if (update.textAlign !== undefined && textAlignTypes.includes(field.type)) {
          nextMeta.textAlign = update.textAlign;
        }

        if (update.required !== undefined && requiredReadonlyTypes.includes(field.type)) {
          nextMeta.required = update.required;
        }

        if (update.readOnly !== undefined && requiredReadonlyTypes.includes(field.type)) {
          nextMeta.readOnly = update.readOnly;
        }

        const parsed = ZFieldMetaSchema.safeParse(nextMeta);

        return {
          ...field,
          fieldMeta: parsed.success ? parsed.data : (existingMeta as FieldMeta | undefined),
        };
      });

      form.setValue('fields', updatedFields);
      void handleAutoSave();
    },
    [form, selectedFieldIds],
  );

  const bulkDelete = useCallback(() => {
    const indices = localFields
      .map((field, index) => (selectedFieldIds.includes(field.formId) ? index : -1))
      .filter((index) => index !== -1);

    // Remove from highest index down so earlier indices remain valid.
    indices
      .slice()
      .sort((a, b) => b - a)
      .forEach((index) => remove(index));

    clearSelection();
    void handleAutoSave();
  }, [localFields, selectedFieldIds, remove, clearSelection]);

  const bulkDuplicate = useCallback(() => {
    const toDuplicate = localFields.filter((field) => selectedFieldIds.includes(field.formId));
    const newIds: string[] = [];

    toDuplicate.forEach((field) => {
      const newId = nanoid(12);
      newIds.push(newId);

      append({
        ...structuredClone(field),
        nativeId: undefined,
        formId: newId,
        pageX: field.pageX + 3,
        pageY: field.pageY + 3,
      });
    });

    setSelectedFieldIds(newIds);
    void handleAutoSave();
  }, [localFields, selectedFieldIds, append]);

  const [selectedField, setSelectedField] = useState<FieldType | null>(null);
  const [selectedSigner, setSelectedSigner] = useState<TRecipientLite | null>(null);
  const [lastActiveField, setLastActiveField] = useState<TAddFieldsFormSchema['fields'][0] | null>(
    null,
  );
  const [fieldClipboard, setFieldClipboard] = useState<TAddFieldsFormSchema['fields'][0] | null>(
    null,
  );
  const selectedSignerIndex = recipients.findIndex((r) => r.id === selectedSigner?.id);
  const selectedSignerStyles = getRecipientColorStyles(selectedSignerIndex);

  const [validateUninsertedFields, setValidateUninsertedFields] = useState(false);

  const filterFieldsWithEmptyValues = (fields: typeof localFields, fieldType: string) =>
    fields
      .filter((field) => field.type === fieldType)
      .filter((field) => {
        if (field.fieldMeta && 'values' in field.fieldMeta) {
          return field.fieldMeta.values?.length === 0;
        }

        return true;
      });

  const emptyCheckboxFields = useMemo(
    () => filterFieldsWithEmptyValues(localFields, FieldType.CHECKBOX),
    [localFields],
  );

  const emptyRadioFields = useMemo(
    () => filterFieldsWithEmptyValues(localFields, FieldType.RADIO),
    [localFields],
  );

  const emptySelectFields = useMemo(
    () => filterFieldsWithEmptyValues(localFields, FieldType.DROPDOWN),
    [localFields],
  );

  const hasErrors =
    emptyCheckboxFields.length > 0 || emptyRadioFields.length > 0 || emptySelectFields.length > 0;

  const fieldsWithError = useMemo(() => {
    const fields = localFields.filter((field) => {
      const hasError =
        ((field.type === FieldType.CHECKBOX ||
          field.type === FieldType.RADIO ||
          field.type === FieldType.DROPDOWN) &&
          field.fieldMeta === undefined) ||
        (field.fieldMeta && 'values' in field.fieldMeta && field?.fieldMeta?.values?.length === 0);

      return hasError;
    });

    const mappedFields = fields.map((field) => ({
      id: field.nativeId ?? 0,
      secondaryId: field.formId,
      documentId: null,
      templateId: null,
      recipientId: 0,
      type: field.type,
      page: field.pageNumber,
      positionX: new Prisma.Decimal(field.pageX),
      positionY: new Prisma.Decimal(field.pageY),
      width: new Prisma.Decimal(field.pageWidth),
      height: new Prisma.Decimal(field.pageHeight),
      customText: '',
      inserted: true,
      fieldMeta: field.fieldMeta ?? null,
    }));

    return mappedFields;
  }, [localFields]);

  const isFieldsDisabled = useMemo(() => {
    if (!selectedSigner) {
      return true;
    }

    return !canRecipientFieldsBeModified(selectedSigner, fields);
  }, [selectedSigner, fields]);

  const [isFieldWithinBounds, setIsFieldWithinBounds] = useState(false);
  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
  });

  const fieldBounds = useRef({
    height: 0,
    width: 0,
  });

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      setIsFieldWithinBounds(
        isWithinPageBounds(
          event,
          PDF_VIEWER_PAGE_SELECTOR,
          fieldBounds.current.width,
          fieldBounds.current.height,
        ),
      );

      setCoords({
        x: event.clientX - fieldBounds.current.width / 2,
        y: event.clientY - fieldBounds.current.height / 2,
      });
    },
    [isWithinPageBounds],
  );

  const onMouseClick = useCallback(
    (event: MouseEvent) => {
      if (!selectedField || !selectedSigner) {
        return;
      }

      const $page = getPage(event, PDF_VIEWER_PAGE_SELECTOR);

      if (
        !$page ||
        !isWithinPageBounds(
          event,
          PDF_VIEWER_PAGE_SELECTOR,
          fieldBounds.current.width,
          fieldBounds.current.height,
        )
      ) {
        setSelectedField(null);
        return;
      }

      const { top, left, height, width } = getBoundingClientRect($page);

      const pageNumber = parseInt($page.getAttribute('data-page-number') ?? '1', 10);

      // Calculate x and y as a percentage of the page width and height
      let pageX = ((event.pageX - left) / width) * 100;
      let pageY = ((event.pageY - top) / height) * 100;

      // Get the bounds as a percentage of the page width and height
      const fieldPageWidth = (fieldBounds.current.width / width) * 100;
      const fieldPageHeight = (fieldBounds.current.height / height) * 100;

      // And center it based on the bounds
      pageX -= fieldPageWidth / 2;
      pageY -= fieldPageHeight / 2;

      const field = {
        formId: nanoid(12),
        nativeId: undefined,
        type: selectedField,
        pageNumber,
        pageX,
        pageY,
        pageWidth: fieldPageWidth,
        pageHeight: fieldPageHeight,
        signerEmail: selectedSigner.email,
        recipientId: selectedSigner.id,
        fieldMeta: undefined,
      };

      append(field);

      // Only open fields with significant amount of settings (instead of just a font setting) to
      // reduce friction when adding fields.
      if (ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING.includes(selectedField)) {
        setCurrentField(field);
        setShowAdvancedSettings(true);
      }

      setIsFieldWithinBounds(false);
      setSelectedField(null);
    },
    [append, isWithinPageBounds, selectedField, selectedSigner, getPage],
  );

  const onFieldResize = useCallback(
    (node: HTMLElement, index: number) => {
      const field = localFields[index];

      const $page = window.document.querySelector<HTMLElement>(
        `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.pageNumber}"]`,
      );

      if (!$page) {
        return;
      }

      const {
        x: pageX,
        y: pageY,
        width: pageWidth,
        height: pageHeight,
      } = getFieldPosition($page, node);

      update(index, {
        ...field,
        pageX,
        pageY,
        pageWidth,
        pageHeight,
      });
    },
    [getFieldPosition, localFields, update],
  );

  const onFieldMove = useCallback(
    (node: HTMLElement, index: number) => {
      const field = localFields[index];

      const $page = window.document.querySelector<HTMLElement>(
        `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${field.pageNumber}"]`,
      );

      if (!$page) {
        return;
      }

      const { x: pageX, y: pageY } = getFieldPosition($page, node);

      update(index, {
        ...field,
        pageX,
        pageY,
      });
    },
    [getFieldPosition, localFields, update],
  );

  const onFieldCopy = useCallback(
    (event?: KeyboardEvent | null, options?: { duplicate?: boolean; duplicateAll?: boolean }) => {
      const { duplicate = false, duplicateAll = false } = options ?? {};

      if (lastActiveField) {
        event?.preventDefault();

        if (duplicate) {
          const newField: TAddFieldsFormSchema['fields'][0] = {
            ...structuredClone(lastActiveField),
            nativeId: undefined,
            formId: nanoid(12),
            signerEmail: selectedSigner?.email ?? lastActiveField.signerEmail,
            recipientId: selectedSigner?.id ?? lastActiveField.recipientId,
            pageX: lastActiveField.pageX + 3,
            pageY: lastActiveField.pageY + 3,
          };

          append(newField);

          return;
        }

        if (duplicateAll) {
          const totalPages = getPdfPagesCount();

          if (totalPages < 1) {
            return;
          }

          for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
            if (pageNumber === lastActiveField.pageNumber) {
              continue;
            }

            const newField: TAddFieldsFormSchema['fields'][0] = {
              ...structuredClone(lastActiveField),
              nativeId: undefined,
              formId: nanoid(12),
              signerEmail: selectedSigner?.email ?? lastActiveField.signerEmail,
              recipientId: selectedSigner?.id ?? lastActiveField.recipientId,
              pageNumber,
            };

            append(newField);
          }

          return;
        }

        setFieldClipboard(lastActiveField);

        toast({
          title: _(msg`Copied field`),
          description: _(msg`Copied field to clipboard`),
        });
      }
    },
    [append, lastActiveField, selectedSigner?.email, selectedSigner?.id, toast],
  );

  const onFieldPaste = useCallback(
    (event: KeyboardEvent) => {
      if (fieldClipboard) {
        event.preventDefault();

        const copiedField = structuredClone(fieldClipboard);

        append({
          ...copiedField,
          nativeId: undefined,
          formId: nanoid(12),
          signerEmail: selectedSigner?.email ?? copiedField.signerEmail,
          recipientId: selectedSigner?.id ?? copiedField.recipientId,
          pageX: copiedField.pageX + 3,
          pageY: copiedField.pageY + 3,
        });
      }
    },
    [append, fieldClipboard, selectedSigner?.email],
  );

  useEffect(() => {
    if (selectedField) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseClick);
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseClick);
    };
  }, [onMouseClick, onMouseMove, selectedField]);

  // Marquee (drag-select) on the PDF page surface — selects every field whose bounding rect
  // intersects the drawn box. Skipped while the user is placing a new field.
  useEffect(() => {
    if (selectedField) {
      return;
    }

    const MIN_DRAG_PX = 4;

    let startTarget: HTMLElement | null = null;
    let startClientX = 0;
    let startClientY = 0;
    let startPageX = 0;
    let startPageY = 0;
    let pageEl: HTMLElement | null = null;
    let pageNumber: number | null = null;
    let pageRect: DOMRect | null = null;
    let active = false;
    let additive = false;

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }

      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      // Ignore mousedowns that originate inside a field item (they portal to body so they're
      // siblings of the page, not children).
      if (event.target.closest('[data-field-id], [data-field-type]')) {
        return;
      }

      const $page = event.target.closest<HTMLElement>(PDF_VIEWER_PAGE_SELECTOR);

      if (!$page) {
        return;
      }

      startTarget = event.target;
      startClientX = event.clientX;
      startClientY = event.clientY;
      pageEl = $page;
      pageRect = $page.getBoundingClientRect();
      pageNumber = parseInt($page.getAttribute('data-page-number') ?? '1', 10);

      startPageX = ((event.clientX - pageRect.left) / pageRect.width) * 100;
      startPageY = ((event.clientY - pageRect.top) / pageRect.height) * 100;

      additive = event.shiftKey || event.metaKey || event.ctrlKey;
      active = false;
    };

    const onMove = (event: MouseEvent) => {
      if (!startTarget || !pageRect || !pageEl || pageNumber === null) {
        return;
      }

      const dx = event.clientX - startClientX;
      const dy = event.clientY - startClientY;

      if (!active && Math.abs(dx) < MIN_DRAG_PX && Math.abs(dy) < MIN_DRAG_PX) {
        return;
      }

      active = true;

      const currentPageX = ((event.clientX - pageRect.left) / pageRect.width) * 100;
      const currentPageY = ((event.clientY - pageRect.top) / pageRect.height) * 100;

      setMarquee({
        pageNumber,
        startX: startPageX,
        startY: startPageY,
        currentX: currentPageX,
        currentY: currentPageY,
      });
    };

    const onUp = (event: MouseEvent) => {
      if (!startTarget) {
        return;
      }

      if (!active) {
        // Plain click on the page (not a drag) — clear selection unless modifier held.
        if (!additive) {
          clearSelection();
        }

        startTarget = null;
        return;
      }

      const finalPageX =
        pageRect && pageRect.width
          ? ((event.clientX - pageRect.left) / pageRect.width) * 100
          : startPageX;
      const finalPageY =
        pageRect && pageRect.height
          ? ((event.clientY - pageRect.top) / pageRect.height) * 100
          : startPageY;

      const left = Math.min(startPageX, finalPageX);
      const right = Math.max(startPageX, finalPageX);
      const top = Math.min(startPageY, finalPageY);
      const bottom = Math.max(startPageY, finalPageY);

      const hitIds = localFields
        .filter((field) => field.pageNumber === pageNumber)
        .filter((field) => {
          const fLeft = field.pageX;
          const fTop = field.pageY;
          const fRight = field.pageX + field.pageWidth;
          const fBottom = field.pageY + field.pageHeight;

          return !(fRight < left || fLeft > right || fBottom < top || fTop > bottom);
        })
        .map((field) => field.formId);

      setSelectedFieldIds((prev) => {
        if (additive) {
          const merged = new Set([...prev, ...hitIds]);
          return Array.from(merged);
        }

        return hitIds;
      });

      setMarquee(null);
      startTarget = null;
      active = false;
    };

    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clearSelection, localFields, selectedField]);

  useEffect(() => {
    const observer = new MutationObserver((_mutations) => {
      const $page = document.querySelector(PDF_VIEWER_PAGE_SELECTOR);

      if (!$page) {
        return;
      }

      fieldBounds.current = {
        height: Math.max(DEFAULT_HEIGHT_PX),
        width: Math.max(DEFAULT_WIDTH_PX),
      };
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const recipientsByRoleToDisplay = recipients.filter(
      (recipient) =>
        recipient.role !== RecipientRole.CC && recipient.role !== RecipientRole.ASSISTANT,
    );

    setSelectedSigner(
      recipientsByRoleToDisplay.find((r) => r.sendStatus !== SendStatus.SENT) ??
        recipientsByRoleToDisplay[0],
    );
  }, [recipients]);

  const recipientsByRole = useMemo(() => {
    const recipientsByRole: Record<RecipientRole, TRecipientLite[]> = {
      CC: [],
      VIEWER: [],
      SIGNER: [],
      APPROVER: [],
      ASSISTANT: [],
    };

    recipients.forEach((recipient) => {
      recipientsByRole[recipient.role].push(recipient);
    });

    return recipientsByRole;
  }, [recipients]);

  const handleAdvancedSettings = () => {
    setShowAdvancedSettings((prev) => !prev);
  };

  const handleGoNextClick = () => {
    // localFields already have recipientId set correctly (see field creation at line 338)
    // Using the existing recipientId is important for handling duplicate email recipients
    const recipientsMissingFields = getRecipientsWithMissingFields(recipients, localFields);

    if (recipientsMissingFields.length > 0) {
      setIsMissingSignatureDialogVisible(true);
      return;
    }

    setValidateUninsertedFields(true);
    const isFieldsValid = validateFieldsUninserted();

    if (!isFieldsValid) {
      return;
    } else {
      void onFormSubmit();
    }
  };

  const { scheduleSave } = useAutoSave(onAutoSave);

  const handleAutoSave = async () => {
    const isFormValid = await form.trigger();

    if (!isFormValid) {
      return;
    }

    const formData = form.getValues();

    scheduleSave(formData);
  };

  return (
    <>
      {showAdvancedSettings && currentField ? (
        <FieldAdvancedSettings
          title={msg`Advanced settings`}
          description={msg`Configure the ${parseMessageDescriptor(
            _,
            FRIENDLY_FIELD_TYPE[currentField.type],
          )} field`}
          field={currentField}
          fields={localFields}
          onAdvancedSettings={handleAdvancedSettings}
          isDocumentPdfLoaded={isDocumentPdfLoaded}
          onSave={(fieldState) => {
            handleSavedFieldSettings(fieldState);
            void handleAutoSave();
          }}
          onAutoSave={async (fieldState) => {
            handleSavedFieldSettings(fieldState);
            await handleAutoSave();
          }}
        />
      ) : (
        <>
          <DocumentFlowFormContainerHeader
            title={documentFlow.title}
            description={documentFlow.description}
          />

          <DocumentFlowFormContainerContent>
            <div className="flex flex-col">
              {selectedField && (
                <div
                  className={cn(
                    'dark:text-muted-background text-muted-foreground [container-type:size] pointer-events-none fixed z-50 flex cursor-pointer flex-col items-center justify-center rounded-[2px] bg-white ring-2 transition duration-200',
                    selectedSignerStyles?.base,
                    {
                      'scale-90 -rotate-6 opacity-50 dark:bg-black/20': !isFieldWithinBounds,
                      'dark:text-black/60': isFieldWithinBounds,
                    },
                  )}
                  style={{
                    top: coords.y,
                    left: coords.x,
                    height: fieldBounds.current.height,
                    width: fieldBounds.current.width,
                  }}
                >
                  <span className="text-[clamp(0.425rem,25cqw,0.825rem)]">
                    {parseMessageDescriptor(_, FRIENDLY_FIELD_TYPE[selectedField])}
                  </span>
                </div>
              )}

              {marquee && <MarqueeOverlay marquee={marquee} />}

              {isDocumentPdfLoaded &&
                localFields.map((field, index) => {
                  const recipientIndex = recipients.findIndex((r) => r.id === field.recipientId);
                  const hasFieldError =
                    emptyCheckboxFields.find((f) => f.formId === field.formId) ||
                    emptyRadioFields.find((f) => f.formId === field.formId) ||
                    emptySelectFields.find((f) => f.formId === field.formId);

                  return (
                    <FieldItem
                      key={index}
                      recipientIndex={recipientIndex === -1 ? 0 : recipientIndex}
                      field={field}
                      disabled={
                        selectedSigner?.email !== field.signerEmail ||
                        !canRecipientBeModified(selectedSigner, fields)
                      }
                      minHeight={MIN_HEIGHT_PX}
                      minWidth={MIN_WIDTH_PX}
                      defaultHeight={DEFAULT_HEIGHT_PX}
                      defaultWidth={DEFAULT_WIDTH_PX}
                      passive={isFieldWithinBounds && !!selectedField}
                      onFocus={() => setLastActiveField(field)}
                      onBlur={() => {
                        setLastActiveField(null);
                        void handleAutoSave();
                      }}
                      onMouseEnter={() => setLastActiveField(field)}
                      onMouseLeave={() => setLastActiveField(null)}
                      onResize={(options) => onFieldResize(options, index)}
                      onMove={(options) => onFieldMove(options, index)}
                      onRemove={() => {
                        remove(index);
                        void handleAutoSave();
                      }}
                      onDuplicate={() => {
                        onFieldCopy(null, { duplicate: true });
                        void handleAutoSave();
                      }}
                      onDuplicateAllPages={() => {
                        onFieldCopy(null, { duplicateAll: true });
                        void handleAutoSave();
                      }}
                      onAdvancedSettings={() => {
                        setCurrentField(field);
                        handleAdvancedSettings();
                      }}
                      hasErrors={!!hasFieldError}
                      active={activeFieldId === field.formId}
                      selected={selectedFieldIds.includes(field.formId)}
                      multiSelectActive={isMultiSelectActive}
                      onFieldActivate={() => setActiveFieldId(field.formId)}
                      onFieldDeactivate={() => setActiveFieldId(null)}
                      onSelect={(modifiers) => handleFieldSelect(field.formId, modifiers)}
                    />
                  );
                })}

              {!hideRecipients && (
                <RecipientSelector
                  selectedRecipient={selectedSigner}
                  onSelectedRecipientChange={setSelectedSigner}
                  recipients={recipients}
                  className="mt-2 mb-12"
                />
              )}

              {isMultiSelectActive && (
                <BulkFieldSettings
                  selectedFields={selectedFields}
                  onClose={clearSelection}
                  onApply={applyBulkUpdate}
                  onBulkDelete={bulkDelete}
                  onBulkDuplicate={bulkDuplicate}
                />
              )}

              <Form {...form}>
                <div className="-mx-2 flex-1 overflow-y-auto px-2">
                  <fieldset
                    disabled={isFieldsDisabled || isMultiSelectActive}
                    className="my-2 grid grid-cols-3 gap-4"
                  >
                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.SIGNATURE)}
                      onMouseDown={() => setSelectedField(FieldType.SIGNATURE)}
                      data-selected={selectedField === FieldType.SIGNATURE ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="flex flex-col items-center justify-center px-6 py-4">
                          <p
                            className={cn(
                              'font-signature text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-lg font-normal',
                            )}
                          >
                            <Trans>Signature</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.INITIALS)}
                      onMouseDown={() => setSelectedField(FieldType.INITIALS)}
                      data-selected={selectedField === FieldType.INITIALS ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="flex flex-col items-center justify-center px-6 py-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <Contact className="h-4 w-4" />
                            <Trans>Initials</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.EMAIL)}
                      onMouseDown={() => setSelectedField(FieldType.EMAIL)}
                      data-selected={selectedField === FieldType.EMAIL ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="flex flex-col items-center justify-center px-6 py-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <Mail className="h-4 w-4" />
                            <Trans>Email</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.NAME)}
                      onMouseDown={() => setSelectedField(FieldType.NAME)}
                      data-selected={selectedField === FieldType.NAME ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <User className="h-4 w-4" />
                            <Trans>Name</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.DATE)}
                      onMouseDown={() => setSelectedField(FieldType.DATE)}
                      data-selected={selectedField === FieldType.DATE ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <CalendarDays className="h-4 w-4" />
                            <Trans>Date</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.TEXT)}
                      onMouseDown={() => setSelectedField(FieldType.TEXT)}
                      data-selected={selectedField === FieldType.TEXT ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <Type className="h-4 w-4" />
                            <Trans>Text</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.NUMBER)}
                      onMouseDown={() => setSelectedField(FieldType.NUMBER)}
                      data-selected={selectedField === FieldType.NUMBER ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <Hash className="h-4 w-4" />
                            <Trans>Number</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.RADIO)}
                      onMouseDown={() => setSelectedField(FieldType.RADIO)}
                      data-selected={selectedField === FieldType.RADIO ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <Disc className="h-4 w-4" />
                            <Trans>Radio</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.CHECKBOX)}
                      onMouseDown={() => setSelectedField(FieldType.CHECKBOX)}
                      data-selected={selectedField === FieldType.CHECKBOX ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <CheckSquare className="h-4 w-4" />
                            <Trans>Checkbox</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>

                    <button
                      type="button"
                      className="group h-full w-full"
                      onClick={() => setSelectedField(FieldType.DROPDOWN)}
                      onMouseDown={() => setSelectedField(FieldType.DROPDOWN)}
                      data-selected={selectedField === FieldType.DROPDOWN ? true : undefined}
                    >
                      <Card
                        className={cn(
                          'flex h-full w-full cursor-pointer items-center justify-center group-disabled:opacity-50',
                        )}
                      >
                        <CardContent className="p-4">
                          <p
                            className={cn(
                              'text-muted-foreground group-data-[selected]:text-foreground flex items-center justify-center gap-x-1.5 text-sm font-normal',
                            )}
                          >
                            <ChevronDown className="h-4 w-4" />
                            <Trans>Dropdown</Trans>
                          </p>
                        </CardContent>
                      </Card>
                    </button>
                  </fieldset>
                </div>
              </Form>
            </div>
          </DocumentFlowFormContainerContent>

          {hasErrors && (
            <div className="mt-4">
              <ul>
                <li className="text-sm text-red-500">
                  <Trans>
                    To proceed further, please set at least one value for the{' '}
                    {emptyCheckboxFields.length > 0
                      ? 'Checkbox'
                      : emptyRadioFields.length > 0
                        ? 'Radio'
                        : 'Select'}{' '}
                    field.
                  </Trans>
                </li>
              </ul>
            </div>
          )}

          {selectedSigner && !canRecipientFieldsBeModified(selectedSigner, fields) && (
            <Alert variant="warning">
              <AlertDescription>
                <Trans>
                  This recipient can no longer be modified as they have signed a field, or completed
                  the document.
                </Trans>
              </AlertDescription>
            </Alert>
          )}

          <DocumentFlowFormContainerFooter>
            <DocumentFlowFormContainerStep step={currentStep} maxStep={totalSteps} />

            <DocumentFlowFormContainerActions
              loading={form.formState.isSubmitting}
              disabled={form.formState.isSubmitting}
              disableNextStep={hasErrors}
              onGoBackClick={() => {
                previousStep();
                remove();
                documentFlow.onBackStep?.();
              }}
              goBackLabel={canRenderBackButtonAsRemove ? msg`Remove` : undefined}
              onGoNextClick={handleGoNextClick}
            />
          </DocumentFlowFormContainerFooter>

          <MissingSignatureFieldDialog
            isOpen={isMissingSignatureDialogVisible}
            onOpenChange={(value) => setIsMissingSignatureDialogVisible(value)}
          />
        </>
      )}
      {validateUninsertedFields && fieldsWithError[0] && (
        <FieldToolTip key={fieldsWithError[0].id} field={fieldsWithError[0]} color="warning">
          <Trans>Empty field</Trans>
        </FieldToolTip>
      )}
    </>
  );
};

type MarqueeOverlayProps = {
  marquee: {
    pageNumber: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  };
};

/**
 * Renders the marquee rectangle as a fixed-position overlay during drag-select.
 * Coordinates in the marquee state are in page-percent units; we resolve them to viewport
 * pixels by reading the current page element's bounding rect.
 */
const MarqueeOverlay = ({ marquee }: MarqueeOverlayProps) => {
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const $page = document.querySelector<HTMLElement>(
      `${PDF_VIEWER_PAGE_SELECTOR}[data-page-number="${marquee.pageNumber}"]`,
    );

    if (!$page) {
      setRect(null);
      return;
    }

    const pageRect = $page.getBoundingClientRect();

    const minX = Math.min(marquee.startX, marquee.currentX);
    const maxX = Math.max(marquee.startX, marquee.currentX);
    const minY = Math.min(marquee.startY, marquee.currentY);
    const maxY = Math.max(marquee.startY, marquee.currentY);

    setRect({
      top: pageRect.top + (minY / 100) * pageRect.height,
      left: pageRect.left + (minX / 100) * pageRect.width,
      width: ((maxX - minX) / 100) * pageRect.width,
      height: ((maxY - minY) / 100) * pageRect.height,
    });
  }, [marquee.currentX, marquee.currentY, marquee.pageNumber, marquee.startX, marquee.startY]);

  if (!rect || typeof window === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-[55] rounded-sm border border-blue-500 bg-blue-500/10"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      data-testid="field-marquee"
    />,
    document.body,
  );
};
