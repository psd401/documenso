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

const GUEST_SPEAKER_TEMPLATE_ID = 'guest-speaker';

// Standard US Letter page size in points.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

const toPercentX = (points: number) => (points / PAGE_WIDTH) * 100;
const toPercentY = (points: number) => (points / PAGE_HEIGHT) * 100;

/**
 * Generates the Guest Speaker Approval form PDF.
 *
 * The field rectangles drawn here are kept in sync with the field coordinates
 * declared on {@link guestSpeakerTemplate} so the interactive fields line up
 * with the printed labels.
 */
const buildGuestSpeakerPdf = async (): Promise<Uint8Array> => {
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

  // Header.
  drawText('Guest Speaker Approval Form', { x: 50, top: 50, size: 20, bold: true });
  drawText('Submit this form to request approval for a guest speaker visit.', {
    x: 50,
    top: 80,
    size: 11,
    color: muted,
  });

  // The field layout is data-driven so the drawn labels/boxes always match the
  // interactive fields declared on the template definition.
  const labelled = [
    { label: 'Requesting Staff Member Name', top: 130 },
    { label: 'Building / School', top: 184 },
    { label: 'Date Submitted', top: 238 },
    { label: 'Guest Speaker Name', top: 292 },
    { label: "Speaker's Organization", top: 346 },
    { label: 'Date of Visit', top: 400 },
    { label: 'Topic / Purpose of Visit', top: 454 },
  ];

  drawSectionHeader('Submission Details', 110);

  for (const { label, top } of labelled) {
    drawText(label, { x: 50, top, size: 10, color: muted });
    drawFieldBox(50, top + 14, 512, 24);
  }

  // Staff signature.
  drawSectionHeader('Staff Signature', 510);
  drawText('Signature', { x: 50, top: 534, size: 10, color: muted });
  drawFieldBox(50, 548, 240, 44);
  drawText('Date', { x: 320, top: 534, size: 10, color: muted });
  drawFieldBox(320, 548, 240, 24);

  // Administrator approval.
  drawSectionHeader('Administrator Approval', 620);
  drawText('Approver Signature', { x: 50, top: 644, size: 10, color: muted });
  drawFieldBox(50, 658, 240, 44);
  drawText('Approval Date', { x: 320, top: 644, size: 10, color: muted });
  drawFieldBox(320, 658, 240, 24);

  drawText(
    'Once submitted, this form routes to the building administrator for approval.',
    { x: 50, top: 730, size: 9, color: muted },
  );

  return pdf.save();
};

const STAFF_RECIPIENT_EMAIL = 'recipient.1@documenso.com';
const ADMINISTRATOR_RECIPIENT_EMAIL = 'recipient.2@documenso.com';

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

export const guestSpeakerTemplate: StarterTemplate = {
  id: GUEST_SPEAKER_TEMPLATE_ID,
  title: 'Guest Speaker Approval Form',
  description:
    'A ready-to-use form for staff to request approval for a guest speaker. Routes to the building administrator for signature.',
  publicTitle: 'Guest Speaker Approval Form',
  publicDescription:
    'Request approval for a guest speaker visit. Your submission will be routed to the building administrator for approval.',
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
          positionY: toPercentY(144),
          width: toPercentX(508),
          height: toPercentY(20),
        },
        textField('Building / School', { x: 52, top: 198, width: 508, height: 20 }),
        {
          type: FieldType.DATE,
          fieldMeta: { type: 'date', label: 'Date Submitted' },
          page: 1,
          positionX: toPercentX(52),
          positionY: toPercentY(252),
          width: toPercentX(508),
          height: toPercentY(20),
        },
        textField('Guest Speaker Name', { x: 52, top: 306, width: 508, height: 20 }),
        textField("Speaker's Organization", { x: 52, top: 360, width: 508, height: 20 }),
        textField('Date of Visit', { x: 52, top: 414, width: 508, height: 20 }),
        textField('Topic / Purpose of Visit', { x: 52, top: 468, width: 508, height: 20 }),
        {
          type: FieldType.SIGNATURE,
          fieldMeta: undefined,
          page: 1,
          positionX: toPercentX(52),
          positionY: toPercentY(550),
          width: toPercentX(236),
          height: toPercentY(40),
        },
        {
          type: FieldType.DATE,
          fieldMeta: { type: 'date', label: 'Date' },
          page: 1,
          positionX: toPercentX(322),
          positionY: toPercentY(550),
          width: toPercentX(236),
          height: toPercentY(20),
        },
      ],
    },
    {
      name: 'Building Administrator',
      email: ADMINISTRATOR_RECIPIENT_EMAIL,
      role: RecipientRole.APPROVER,
      signingOrder: 2,
      fields: [
        {
          type: FieldType.SIGNATURE,
          fieldMeta: undefined,
          page: 1,
          positionX: toPercentX(52),
          positionY: toPercentY(660),
          width: toPercentX(236),
          height: toPercentY(40),
        },
        {
          type: FieldType.DATE,
          fieldMeta: { type: 'date', label: 'Approval Date' },
          page: 1,
          positionX: toPercentX(322),
          positionY: toPercentY(660),
          width: toPercentX(236),
          height: toPercentY(20),
        },
      ],
    },
  ],
  buildPdf: buildGuestSpeakerPdf,
};

export const STARTER_TEMPLATES: StarterTemplate[] = [guestSpeakerTemplate];

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
