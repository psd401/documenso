// ABOUTME: Renders the email TemplateFooter and pins the district office address in the
// ABOUTME: branding-disabled fallback, plus custom company details when branding is enabled.

import { renderWithI18N } from '@documenso/email/render';
import TemplateFooter from '@documenso/email/template-components/template-footer';
import { setupI18n } from '@lingui/core';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

// The lingui macro plugin compiles `<Trans>` to the runtime component, which
// needs an I18nProvider, so render with a bare English i18n instance.
const i18n = setupI18n({ locale: 'en', messages: { en: {} } });

describe('TemplateFooter', () => {
  it('renders the district office address when branding is disabled', async () => {
    const html = await renderWithI18N(createElement(TemplateFooter), { i18n });

    expect(html).toContain('Peninsula School District');
    expect(html).toContain('14015 62nd Ave NW, Gig Harbor, WA 98332');
    expect(html).not.toContain('1st Ave S');
  });

  it('renders custom company details instead when branding is enabled', async () => {
    const html = await renderWithI18N(createElement(TemplateFooter), {
      i18n,
      branding: {
        brandingEnabled: true,
        brandingUrl: 'https://psd401.net',
        brandingLogo: '',
        brandingCompanyDetails: 'Peninsula School District\n14015 62nd Ave NW',
        brandingHidePoweredBy: false,
      },
    });

    expect(html).toContain('14015 62nd Ave NW');
    expect(html).not.toContain('1st Ave S');
  });
});
