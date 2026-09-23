// ABOUTME: Unit tests for the Konva field rect fill in the signer view.
// ABOUTME: Checkbox/radio rects stay transparent unless embed CSS sets a custom background.
import { FIELD_ROOT_CONTAINER_DEFAULT_BACKGROUND } from '@documenso/ui/lib/field-root-container-classes';
import { FieldType } from '@prisma/client';
import { colord } from 'colord';
import type Konva from 'konva';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { FieldCanvasStyle, FieldToRender, RenderFieldElementOptions } from './field-renderer';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let KonvaNode: typeof import('konva').default;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let items: typeof import('./field-generic-items');

let stage: Konva.Stage | null = null;

beforeAll(async () => {
  await import('../../server-only/konva/skia-backend');

  KonvaNode = (await import('konva')).default;
  items = await import('./field-generic-items');
});

afterEach(() => {
  stage?.destroy();
  stage = null;
});

const createOptions = (fieldCanvasStyle?: FieldCanvasStyle): RenderFieldElementOptions => {
  stage = new KonvaNode.Stage({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  const pageLayer = new KonvaNode.Layer();
  stage.add(pageLayer);

  return {
    pageLayer,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    mode: 'sign',
    scale: 1,
    color: 'readOnly',
    fieldCanvasStyle,
    translations: null,
  };
};

const createField = (type: FieldType): FieldToRender =>
  ({
    renderId: `field-${type}`,
    envelopeItemId: 'envelope_item_test',
    recipientId: 1,
    type,
    page: 1,
    inserted: false,
    width: 10,
    height: 5,
    positionX: 10,
    positionY: 10,
    fieldMeta: null,
    signature: null,
  }) as FieldToRender;

// The style the DOM probe resolves when a `.embed--DocumentContainer` exists but
// no custom embed CSS overrides the shared field container classes.
const defaultProbeStyle: FieldCanvasStyle = { backgroundColor: 'rgba(255, 255, 255, 0.9)' };

// `baseRingHover` for the `readOnly` recipient color.
const HOVER_COLOR = 'rgba(176, 176, 176, 1)';

const waitForTween = async () => new Promise((resolve) => setTimeout(resolve, 450));

describe('upsertFieldRect in sign mode', () => {
  it('treats the probe default as the shared container background', () => {
    expect(defaultProbeStyle.backgroundColor).toBe(FIELD_ROOT_CONTAINER_DEFAULT_BACKGROUND);
  });

  it.each([
    FieldType.CHECKBOX,
    FieldType.RADIO,
  ])('paints %s transparent when the probe resolves the default background', (type) => {
    const field = createField(type);
    const rect = items.upsertFieldRect(field, createOptions(defaultProbeStyle));

    expect(rect.fill()).toBe(items.TRANSPARENT_RECT_BACKGROUND);
  });

  it.each([FieldType.CHECKBOX, FieldType.RADIO])('paints %s transparent when no probe style exists', (type) => {
    const field = createField(type);
    const rect = items.upsertFieldRect(field, createOptions(undefined));

    expect(rect.fill()).toBe(items.TRANSPARENT_RECT_BACKGROUND);
  });

  it('keeps a custom embed background on checkbox fields', () => {
    const field = createField(FieldType.CHECKBOX);
    const rect = items.upsertFieldRect(field, createOptions({ backgroundColor: 'rgb(255, 0, 0)' }));

    expect(rect.fill()).toBe('rgb(255, 0, 0)');
  });

  it('keeps the probe background on text fields', () => {
    const field = createField(FieldType.TEXT);
    const rect = items.upsertFieldRect(field, createOptions(defaultProbeStyle));

    expect(rect.fill()).toBe(defaultProbeStyle.backgroundColor);
  });
});

describe('createFieldHoverInteraction in sign mode', () => {
  it.each([
    FieldType.CHECKBOX,
    FieldType.RADIO,
  ])('returns %s to transparent after hover when the probe resolves the default background', async (type) => {
    const field = createField(type);
    const options = createOptions(defaultProbeStyle);

    const fieldGroup = items.upsertFieldGroup(field, options);
    options.pageLayer.add(fieldGroup);

    const fieldRect = items.upsertFieldRect(field, options);
    fieldGroup.add(fieldRect);

    items.createFieldHoverInteraction({ options, fieldGroup, fieldRect, field });

    fieldGroup.fire('mouseover');
    await waitForTween();
    expect(colord(fieldRect.fill() as string).isEqual(HOVER_COLOR)).toBe(true);

    fieldGroup.fire('mouseout');
    await waitForTween();
    expect(colord(fieldRect.fill() as string).isEqual(items.TRANSPARENT_RECT_BACKGROUND)).toBe(true);
  });

  it('does not animate text fields that carry a probe background', () => {
    const field = createField(FieldType.TEXT);
    const options = createOptions(defaultProbeStyle);

    const fieldGroup = items.upsertFieldGroup(field, options);
    options.pageLayer.add(fieldGroup);

    const fieldRect = items.upsertFieldRect(field, options);
    fieldGroup.add(fieldRect);

    items.createFieldHoverInteraction({ options, fieldGroup, fieldRect, field });

    fieldGroup.fire('mouseover');

    expect(fieldRect.fill()).toBe(defaultProbeStyle.backgroundColor);
  });
});
