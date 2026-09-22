// ABOUTME: Pure matching helpers for directory mapping rules. No I/O, no Prisma.
// ABOUTME: normalizeMappingSourceValue is applied at write time; matchDirectoryMapping applies it again at match time.
import type { DirectoryMappingSourceField } from '@prisma/client';

export const normalizeOrgUnitPath = (value: string): string => {
  const trimmed = value.replace(/\/+$/, '');

  return trimmed === '' ? '/' : trimmed;
};

export const normalizeMappingSourceValue = (
  sourceField: DirectoryMappingSourceField,
  value: string,
): string => {
  const trimmed = value.trim();

  return sourceField === 'GROUP' ? trimmed.toLowerCase() : trimmed;
};

const getGoogleGroupEmails = (googleGroups: unknown): string[] => {
  if (!Array.isArray(googleGroups)) {
    return [];
  }

  return googleGroups.filter((entry): entry is string => typeof entry === 'string');
};

export const matchDirectoryMapping = (
  mapping: { sourceField: DirectoryMappingSourceField; sourceValue: string },
  user: { department: string | null; orgUnitPath: string | null; googleGroups: unknown },
): boolean => {
  if (mapping.sourceField === 'GROUP') {
    const ruleValue = normalizeMappingSourceValue('GROUP', mapping.sourceValue);

    return getGoogleGroupEmails(user.googleGroups).some(
      (email) => normalizeMappingSourceValue('GROUP', email) === ruleValue,
    );
  }

  if (mapping.sourceField === 'DEPARTMENT') {
    return user.department !== null && user.department === mapping.sourceValue;
  }

  if (user.orgUnitPath === null) {
    return false;
  }

  const ruleValue = normalizeOrgUnitPath(mapping.sourceValue);
  const userPath = normalizeOrgUnitPath(user.orgUnitPath);

  if (ruleValue === '/') {
    return true;
  }

  return userPath === ruleValue || userPath.startsWith(`${ruleValue}/`);
};
