// ABOUTME: Safely parses the stored brandingLogo JSON file reference from team/organisation settings.
// ABOUTME: Returns null for empty, malformed, or wrong-shape values instead of throwing.
import { DocumentDataType } from '@prisma/client';
import { z } from 'zod';

const ZBrandingLogoFileSchema = z.object({
  type: z.nativeEnum(DocumentDataType),
  data: z.string(),
});

export type TBrandingLogoFile = z.infer<typeof ZBrandingLogoFileSchema>;

export const parseBrandingLogoFile = (
  value: string | null | undefined,
): TBrandingLogoFile | null => {
  if (!value) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  const result = ZBrandingLogoFileSchema.safeParse(parsed);

  if (!result.success) {
    return null;
  }

  return result.data;
};
