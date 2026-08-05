import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@documenso/email/render';
import TemplateFooter from '@documenso/email/template-components/template-footer';

vi.mock('@lingui/react/macro', () => ({
  Trans: (props: { children?: unknown }) => props.children,
}));

describe('TemplateFooter', () => {
  it('renders the district office address when branding is disabled', async () => {
    const html = await render(createElement(TemplateFooter));

    expect(html).toContain('Peninsula School District');
    expect(html).toContain('14015 62nd Ave NW, Gig Harbor, WA 98332');
    expect(html).not.toContain('1st Ave S');
  });

  it('renders custom company details instead when branding is enabled', async () => {
    const html = await render(createElement(TemplateFooter), {
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
