// ABOUTME: Shared PSD401 organisation and baseline group identifiers used by user provisioning and directory sync.
// ABOUTME: Baseline groups (org member + Default team) are held by every PSD401 user and never revoked by directory sync.

export const PSD401_ORG_ID = 'org_psd401district';

export const PSD401_MEMBER_GROUP_ID = 'org_group_psd401_member';

export const PSD401_DEFAULT_TEAM_GROUP_ID = 'org_group_default_member';

export const PSD401_BASELINE_GROUP_IDS: readonly string[] = [PSD401_MEMBER_GROUP_ID, PSD401_DEFAULT_TEAM_GROUP_ID];
