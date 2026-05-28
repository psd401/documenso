import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { FieldType, RecipientRole } from '@prisma/client';

import type { TFieldAndMeta } from '../../types/field-meta';

/**
 * A field placed on a starter template document.
 *
 * Positions and dimensions are expressed as percentages (0-100) of the page,
 * matching the convention used throughout Documenso for field placement.
 */
export type StarterTemplateField = TFieldAndMeta & {
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
};

export type StarterTemplateRecipient = {
  /** Placeholder name shown in the template editor (the template user replaces this). */
  name: string;
  /** Placeholder email. */
  email: string;
  role: RecipientRole;
  signingOrder: number;
  fields: StarterTemplateField[];
};

export type StarterTemplate = {
  id: string;
  /** Title used for the created template/envelope. */
  title: string;
  /** Short description shown when picking a starter template. */
  description: string;
  /** Public title used when the template is shared via a direct link. */
  publicTitle: string;
  publicDescription: string;
  recipients: StarterTemplateRecipient[];
  /** Builds the backing PDF document for the template. */
  buildPdf: () => Promise<Uint8Array>;
};

const SURPLUS_FORM_TEMPLATE_ID = 'surplus-form';

// Standard US Letter page size in points.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const toPercentX = (points: number) => (points / PAGE_WIDTH) * 100;
const toPercentY = (points: number) => (points / PAGE_HEIGHT) * 100;

/**
 * Generates the Surplus Property/Equipment form PDF.
 *
 * The field rectangles drawn here are kept in sync with the field coordinates
 * declared on {@link surplusFormTemplate} so the interactive fields line up with
 * the printed labels. Field boxes are drawn at `top + 14` (just under each
 * label), which matches the `positionY` used for the corresponding field.
 */
const buildSurplusFormPdf = async (): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.45, 0.45, 0.45);
  const line = rgb(0.7, 0.7, 0.7);

  // pdf-lib uses a bottom-left origin, so convert from our top-left layout.
  const drawText = (
    text: string,
    options: { x: number; top: number; size: number; bold?: boolean; color?: typeof ink },
  ) => {
    const usedFont = options.bold ? boldFont : font;

    page.drawText(text, {
      x: options.x,
      y: PAGE_HEIGHT - options.top - options.size,
      size: options.size,
      font: usedFont,
      color: options.color ?? ink,
    });
  };

  const drawFieldBox = (left: number, top: number, width: number, height: number) => {
    page.drawRectangle({
      x: left,
      y: PAGE_HEIGHT - top - height,
      width,
      height,
      borderColor: line,
      borderWidth: 1,
      color: rgb(0.98, 0.98, 0.98),
    });
  };

  const drawSectionHeader = (text: string, top: number) => {
    drawText(text, { x: 50, top, size: 13, bold: true });

    page.drawLine({
      start: { x: 50, y: PAGE_HEIGHT - top - 18 },
      end: { x: PAGE_WIDTH - 50, y: PAGE_HEIGHT - top - 18 },
      thickness: 1,
      color: line,
    });
  };

  const drawLabelledBox = (
    label: string,
    rect: { x: number; top: number; width: number; height: number },
  ) => {
    drawText(label, { x: rect.x, top: rect.top, size: 10, color: muted });
    drawFieldBox(rect.x, rect.top + 14, rect.width, rect.height);
  };

  // Header.
  drawText('Surplus Property / Equipment Form', { x: 50, top: 50, size: 20, bold: true });
  drawText('Use this form to declare district property or equipment as surplus.', {
    x: 50,
    top: 80,
    size: 11,
    color: muted,
  });

  // Submission details (completed by the requesting staff member).
  drawSectionHeader('Surplus Item Details', 110);

  drawLabelledBox('Requesting Staff Member Name', { x: 50, top: 124, width: 512, height: 24 });
  drawLabelledBox('Department / Building', { x: 50, top: 170, width: 262, height: 24 });
  drawLabelledBox('Date Submitted', { x: 322, top: 170, width: 240, height: 24 });
  drawLabelledBox('Item Description', { x: 50, top: 216, width: 512, height: 24 });
  drawLabelledBox('Quantity', { x: 50, top: 262, width: 110, height: 24 });
  drawLabelledBox('Asset / Serial Number(s)', { x: 180, top: 262, width: 200, height: 24 });
  drawLabelledBox('Estimated Value', { x: 400, top: 262, width: 162, height: 24 });
  drawLabelledBox('Condition', { x: 50, top: 308, width: 262, height: 24 });
  drawLabelledBox('Requested Disposition', { x: 322, top: 308, width: 240, height: 24 });
  drawLabelledBox('Reason for Surplus', { x: 50, top: 354, width: 512, height: 44 });

  // Requesting staff certification.
  drawSectionHeader('Requesting Staff Certification', 430);
  drawText('Signature', { x: 50, top: 449, size: 10, color: muted });
  drawFieldBox(50, 463, 240, 44);
  drawText('Date', { x: 322, top: 449, size: 10, color: muted });
  drawFieldBox(322, 463, 240, 24);

  // Building administrator approval.
  drawSectionHeader('Building Administrator Approval', 530);
  drawText('Approver Signature', { x: 50, top: 549, size: 10, color: muted });
  drawFieldBox(50, 563, 240, 44);
  drawText('Approval Date', { x: 322, top: 549, size: 10, color: muted });
  drawFieldBox(322, 563, 240, 24);

  // Business office / warehouse approval.
  drawSectionHeader('Business Office / Warehouse Approval', 630);
  drawText('Signature', { x: 50, top: 649, size: 10, color: muted });
  drawFieldBox(50, 663, 240, 44);
  drawText('Date', { x: 322, top: 649, size: 10, color: muted });
  drawFieldBox(322, 663, 240, 24);

  drawText(
    'Once submitted, this form routes to the building administrator and then the business office for approval.',
    { x: 50, top: 740, size: 9, color: muted },
  );

  return pdf.save();
};

const STAFF_RECIPIENT_EMAIL = 'recipient.1@documenso.com';
const ADMINISTRATOR_RECIPIENT_EMAIL = 'recipient.2@documenso.com';
const BUSINESS_OFFICE_RECIPIENT_EMAIL = 'recipient.3@documenso.com';

const textField = (
  label: string,
  rect: { x: number; top: number; width: number; height: number },
): StarterTemplateField => ({
  type: FieldType.TEXT,
  fieldMeta: { type: 'text', label, required: true },
  page: 1,
  positionX: toPercentX(rect.x),
  positionY: toPercentY(rect.top),
  width: toPercentX(rect.width),
  height: toPercentY(rect.height),
});

const dateField = (
  label: string,
  rect: { x: number; top: number; width: number; height: number },
): StarterTemplateField => ({
  type: FieldType.DATE,
  fieldMeta: { type: 'date', label },
  page: 1,
  positionX: toPercentX(rect.x),
  positionY: toPercentY(rect.top),
  width: toPercentX(rect.width),
  height: toPercentY(rect.height),
});

const signatureField = (rect: {
  x: number;
  top: number;
  width: number;
  height: number;
}): StarterTemplateField => ({
  type: FieldType.SIGNATURE,
  fieldMeta: undefined,
  page: 1,
  positionX: toPercentX(rect.x),
  positionY: toPercentY(rect.top),
  width: toPercentX(rect.width),
  height: toPercentY(rect.height),
});

export const surplusFormTemplate: StarterTemplate = {
  id: SURPLUS_FORM_TEMPLATE_ID,
  title: 'Surplus Property / Equipment Form',
  description:
    'A ready-to-use form for staff to declare district property or equipment as surplus. Routes to the building administrator and then the business office for approval.',
  publicTitle: 'Surplus Property / Equipment Form',
  publicDescription:
    'Declare district property or equipment as surplus. Your submission will be routed to the building administrator and then the business office for approval.',
  recipients: [
    {
      name: 'Requesting Staff Member',
      email: STAFF_RECIPIENT_EMAIL,
      role: RecipientRole.SIGNER,
      signingOrder: 1,
      fields: [
        {
          type: FieldType.NAME,
          fieldMeta: { type: 'name', label: 'Requesting Staff Member Name' },
          page: 1,
          positionX: toPercentX(52),
          positionY: toPercentY(138),
          width: toPercentX(508),
          height: toPercentY(20),
        },
        textField('Department / Building', { x: 52, top: 184, width: 258, height: 20 }),
        dateField('Date Submitted', { x: 324, top: 184, width: 236, height: 20 }),
        textField('Item Description', { x: 52, top: 230, width: 508, height: 20 }),
        textField('Quantity', { x: 52, top: 276, width: 106, height: 20 }),
        textField('Asset / Serial Number(s)', { x: 182, top: 276, width: 196, height: 20 }),
        textField('Estimated Value', { x: 402, top: 276, width: 158, height: 20 }),
        textField('Condition', { x: 52, top: 322, width: 258, height: 20 }),
        textField('Requested Disposition', { x: 324, top: 322, width: 236, height: 20 }),
        textField('Reason for Surplus', { x: 52, top: 368, width: 508, height: 40 }),
        signatureField({ x: 52, top: 463, width: 236, height: 40 }),
        dateField('Date', { x: 324, top: 463, width: 236, height: 20 }),
      ],
    },
    {
      name: 'Building Administrator',
      email: ADMINISTRATOR_RECIPIENT_EMAIL,
      role: RecipientRole.APPROVER,
      signingOrder: 2,
      fields: [
        signatureField({ x: 52, top: 563, width: 236, height: 40 }),
        dateField('Approval Date', { x: 324, top: 563, width: 236, height: 20 }),
      ],
    },
    {
      name: 'Business Office / Warehouse',
      email: BUSINESS_OFFICE_RECIPIENT_EMAIL,
      role: RecipientRole.APPROVER,
      signingOrder: 3,
      fields: [
        signatureField({ x: 52, top: 663, width: 236, height: 40 }),
        dateField('Date', { x: 324, top: 663, width: 236, height: 20 }),
      ],
    },
  ],
  buildPdf: buildSurplusFormPdf,
};

export const STARTER_TEMPLATES: StarterTemplate[] = [surplusFormTemplate];

export const getStarterTemplateById = (id: string): StarterTemplate | undefined =>
  STARTER_TEMPLATES.find((template) => template.id === id);

/** Lightweight metadata for listing starter templates in the UI. */
export type StarterTemplateSummary = {
  id: string;
  title: string;
  description: string;
};

export const getStarterTemplateSummaries = (): StarterTemplateSummary[] =>
  STARTER_TEMPLATES.map(({ id, title, description }) => ({ id, title, description }));
