// ABOUTME: Verifies the legacy document.create and template.createTemplate routes hand Word files
// ABOUTME: to putNormalizedPdfFileServerSide unconverted, so the fork's LibreOffice pipeline converts them.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPutNormalized = vi.fn();
const mockCreateEnvelope = vi.fn();
const mockGetServerLimits = vi.fn();

vi.mock('@documenso/lib/universal/upload/put-file.server', () => ({
  putNormalizedPdfFileServerSide: mockPutNormalized,
}));

vi.mock('@documenso/lib/server-only/envelope/create-envelope', () => ({
  createEnvelope: mockCreateEnvelope,
}));

vi.mock('@documenso/ee/server-only/limits/server', () => ({
  getServerLimits: mockGetServerLimits,
}));

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => noopLogger,
};

const createCtx = () => ({
  req: new Request('http://localhost/api/trpc'),
  session: { id: 'session_1' },
  user: { id: 1, name: 'Test', email: 'test@psd401.net', disabled: false },
  teamId: 5,
  logger: noopLogger,
  metadata: {
    source: 'app',
    auth: null,
    requestMetadata: {},
  },
});

const docxFile = () => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'contract.docx', { type: DOCX_MIME });

describe('legacy upload routes pass Word files to the LibreOffice pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPutNormalized.mockResolvedValue({ id: 'document_data_1' });
    mockGetServerLimits.mockResolvedValue({ remaining: { documents: 10 } });
    mockCreateEnvelope.mockResolvedValue({ id: 'envelope_1', secondaryId: 'document_1' });
  });

  it('document.create keeps the .docx name so putNormalizedPdfFileServerSide converts it', async () => {
    const { router } = await import('../trpc');
    const { createDocumentRoute } = await import('./create-document');

    const caller = router({ create: createDocumentRoute }).createCaller(createCtx() as never);

    await caller.create({ payload: { title: 'Contract' }, file: docxFile() } as never);

    expect(mockPutNormalized).toHaveBeenCalledTimes(1);
    expect(mockPutNormalized.mock.calls[0][0].name).toBe('contract.docx');
  });

  it('template.createTemplate keeps the .docx name and does not flatten form fields', async () => {
    const { templateRouter } = await import('../template-router/router');

    const caller = templateRouter.createCaller(createCtx() as never);

    await caller.createTemplate({ payload: { title: 'Contract' }, file: docxFile() } as never).catch(() => undefined);

    expect(mockPutNormalized).toHaveBeenCalledTimes(1);
    expect(mockPutNormalized.mock.calls[0][0].name).toBe('contract.docx');
    expect(mockPutNormalized.mock.calls[0][1]).toEqual({ flattenForm: false });
  });
});
