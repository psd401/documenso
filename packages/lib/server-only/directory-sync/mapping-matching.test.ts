// ABOUTME: Unit tests for directory mapping matching semantics.
// ABOUTME: Covers normalization, GROUP case-insensitivity, malformed googleGroups shapes, and ORG_UNIT segment boundaries.

import { describe, expect, it } from 'vitest';

import {
  matchDirectoryMapping,
  normalizeMappingSourceValue,
  normalizeOrgUnitPath,
} from './mapping-matching';

describe('normalizeOrgUnitPath', () => {
  it('strips a single trailing slash', () => {
    expect(normalizeOrgUnitPath('/Staff/GHH/')).toBe('/Staff/GHH');
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeOrgUnitPath('/Staff/GHH///')).toBe('/Staff/GHH');
  });

  it('leaves a path with no trailing slash unchanged', () => {
    expect(normalizeOrgUnitPath('/Staff/GHH')).toBe('/Staff/GHH');
  });

  it('maps root "/" to "/"', () => {
    expect(normalizeOrgUnitPath('/')).toBe('/');
  });

  it('maps an empty string to "/"', () => {
    expect(normalizeOrgUnitPath('')).toBe('/');
  });
});

describe('normalizeMappingSourceValue', () => {
  it('trims and lowercases GROUP values', () => {
    expect(normalizeMappingSourceValue('GROUP', '  Tech-Staff@PSD401.net  ')).toBe(
      'tech-staff@psd401.net',
    );
  });

  it('trims but preserves case for DEPARTMENT values', () => {
    expect(normalizeMappingSourceValue('DEPARTMENT', '  Technology  ')).toBe('Technology');
  });

  it('trims but preserves case for ORG_UNIT values', () => {
    expect(normalizeMappingSourceValue('ORG_UNIT', '  /Staff/GHH  ')).toBe('/Staff/GHH');
  });
});

describe('matchDirectoryMapping', () => {
  describe('GROUP', () => {
    it('matches case-insensitively', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = {
        department: null,
        orgUnitPath: null,
        googleGroups: ['Tech-Staff@PSD401.net'],
      };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match when the group is absent', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = { department: null, orgUnitPath: null, googleGroups: ['all-staff@psd401.net'] };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('treats null googleGroups as no match, with no error', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = { department: null, orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('treats a non-array googleGroups as no match, with no error', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = { department: null, orgUnitPath: null, googleGroups: { not: 'an array' } };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('filters out non-string entries in a mixed-type array', () => {
      const mapping = { sourceField: 'GROUP' as const, sourceValue: 'tech-staff@psd401.net' };
      const user = {
        department: null,
        orgUnitPath: null,
        googleGroups: [42, { email: 'tech-staff@psd401.net' }, 'tech-staff@psd401.net'],
      };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });
  });

  describe('DEPARTMENT', () => {
    it('matches on an exact, case-sensitive string', () => {
      const mapping = { sourceField: 'DEPARTMENT' as const, sourceValue: 'Technology' };
      const user = { department: 'Technology', orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match a different case', () => {
      const mapping = { sourceField: 'DEPARTMENT' as const, sourceValue: 'Technology' };
      const user = { department: 'technology', orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('does not match when the user has no department', () => {
      const mapping = { sourceField: 'DEPARTMENT' as const, sourceValue: 'Technology' };
      const user = { department: null, orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });
  });

  describe('ORG_UNIT', () => {
    it('matches an exact path', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHH', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('matches a child segment', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHH/Teachers', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match a sibling with a matching prefix string', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHHS', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });

    it('matches when the rule value has a trailing slash', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH/' };
      const user = { department: null, orgUnitPath: '/Staff/GHH/Teachers', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('matches when the user path has a trailing slash', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: '/Staff/GHH/', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('a root "/" rule matches every user with a non-null orgUnitPath', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/' };
      const user = { department: null, orgUnitPath: '/Staff/GHH', googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(true);
    });

    it('does not match when the user has no orgUnitPath', () => {
      const mapping = { sourceField: 'ORG_UNIT' as const, sourceValue: '/Staff/GHH' };
      const user = { department: null, orgUnitPath: null, googleGroups: null };

      expect(matchDirectoryMapping(mapping, user)).toBe(false);
    });
  });
});
