import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UiDocument } from '@sutra/contracts';
import { SutraRenderer } from '@sutra/react-renderer';

import { learningExampleById } from '../../apps/studio/src/lib/learning-examples';
import { componentRegistry } from '../../apps/studio/src/lib/registry';
import { defaultSymbolValues } from '../../apps/studio/src/store/studio-store';

function documentFor(exampleId: string): UiDocument {
  const example = learningExampleById(exampleId);
  if (!example) throw new Error(`Missing learning example ${exampleId}`);
  return example.createDocument(`page_${exampleId.replaceAll('-', '_')}_runtime`);
}

function renderLesson(
  document: UiDocument,
  overrides: Record<string, unknown> = {},
  events: Record<string, (...args: unknown[]) => unknown> = {},
) {
  return render(
    <SutraRenderer
      document={document}
      registry={componentRegistry}
      mode="preview"
      viewportWidth={1180}
      symbols={{ ...defaultSymbolValues(document), ...overrides }}
      events={events}
    />,
  );
}

describe('Learning example runtimes', () => {
  it('renders independent prop values and accepts typed overrides', () => {
    const document = documentFor('props-values');
    const { rerender } = renderLesson(document);

    expect(screen.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
    expect(screen.getByText('Members: 24')).toBeVisible();

    rerender(
      <SutraRenderer
        document={document}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{
          ...defaultSymbolValues(document),
          prop_headline: 'Team dashboard',
          prop_memberCount: 42,
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Team dashboard' })).toBeVisible();
    expect(screen.getByText('Members: 42')).toBeVisible();
  });

  it('applies the typed style object only in the props-style lesson', () => {
    const document = documentFor('props-style');
    const defaults = defaultSymbolValues(document);
    const theme = defaults['prop_theme'] as Record<string, Record<string, unknown>>;
    renderLesson(document, {
      prop_theme: {
        ...theme,
        cardStyle: { ...theme['cardStyle'], backgroundColor: '#243c34' },
        accentStyle: { ...theme['accentStyle'], backgroundColor: '#ef476f' },
      },
    });

    expect(screen.getByText('LIVE COMPONENT').parentElement).toHaveStyle({
      backgroundColor: '#243c34',
    });
    expect(screen.getByRole('button', { name: 'Prop-styled button' })).toHaveStyle({
      backgroundColor: '#ef476f',
    });
  });

  it('keeps a basic array loop and nested object loop as separate documents', () => {
    const arrayDocument = documentFor('array-loop');
    const arrayRender = renderLesson(arrayDocument);
    for (const item of ['Design system', 'Desktop shell', 'Logic connector']) {
      expect(screen.getByRole('heading', { name: item })).toBeVisible();
    }
    arrayRender.unmount();

    renderLesson(documentFor('nested-repeat'));
    expect(screen.getByRole('heading', { name: 'Design' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Engineering' })).toBeVisible();
    for (const member of ['Maya Chen', 'Noah Kim', 'Ava Singh', 'Leo Martin']) {
      expect(screen.getByRole('heading', { name: member })).toBeVisible();
    }
  });

  it('switches the dedicated If / Else lesson between complete branches', () => {
    const document = documentFor('if-else');
    const defaults = defaultSymbolValues(document);
    const { rerender } = renderLesson(document);

    expect(screen.getByRole('heading', { name: 'Welcome, Alex' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Please sign in' })).not.toBeInTheDocument();

    rerender(
      <SutraRenderer
        document={document}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{ ...defaults, prop_isSignedIn: false }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Please sign in' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Welcome, Alex' })).not.toBeInTheDocument();
  });

  it('evaluates AND, OR and NOT in their own focused lessons', () => {
    const andDocument = documentFor('logical-and');
    const andDefaults = defaultSymbolValues(andDocument);
    const andRender = renderLesson(andDocument);
    expect(screen.getByText('Signed in AND has notifications')).toBeVisible();
    andRender.rerender(
      <SutraRenderer
        document={andDocument}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{ ...andDefaults, prop_hasNotifications: false }}
      />,
    );
    expect(screen.queryByText('Signed in AND has notifications')).not.toBeInTheDocument();
    andRender.unmount();

    const orDocument = documentFor('logical-or');
    const orDefaults = defaultSymbolValues(orDocument);
    const orRender = renderLesson(orDocument);
    expect(screen.getByText('Edit access granted')).toBeVisible();
    orRender.rerender(
      <SutraRenderer
        document={orDocument}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{ ...orDefaults, prop_isOwner: false, prop_isAdmin: false }}
      />,
    );
    expect(screen.queryByText('Edit access granted')).not.toBeInTheDocument();
    orRender.unmount();

    const notDocument = documentFor('logical-not');
    const notDefaults = defaultSymbolValues(notDocument);
    const notRender = renderLesson(notDocument);
    expect(screen.getByText('Content is ready')).toBeVisible();
    notRender.rerender(
      <SutraRenderer
        document={notDocument}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{ ...notDefaults, prop_isLoading: true }}
      />,
    );
    expect(screen.queryByText('Content is ready')).not.toBeInTheDocument();
  });

  it('changes ternary and fallback values without sharing a mega page', () => {
    const ternaryDocument = documentFor('ternary');
    const ternaryDefaults = defaultSymbolValues(ternaryDocument);
    const ternaryRender = renderLesson(ternaryDocument);
    expect(screen.getByText('FREE PLAN')).toBeVisible();
    ternaryRender.rerender(
      <SutraRenderer
        document={ternaryDocument}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{ ...ternaryDefaults, prop_isPro: true }}
      />,
    );
    expect(screen.getByText('PRO PLAN')).toBeVisible();
    ternaryRender.unmount();

    const fallbackDocument = documentFor('nullish-fallback');
    const fallbackDefaults = defaultSymbolValues(fallbackDocument);
    const fallbackRender = renderLesson(fallbackDocument);
    expect(screen.getByRole('heading', { name: 'Default headline' })).toBeVisible();
    fallbackRender.rerender(
      <SutraRenderer
        document={fallbackDocument}
        registry={componentRegistry}
        mode="preview"
        viewportWidth={1180}
        symbols={{ ...fallbackDefaults, prop_headline: 'Runtime headline' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Runtime headline' })).toBeVisible();
  });

  it('passes one typed Repeat item id to the event lesson', () => {
    const document = documentFor('typed-event-argument');
    const onSelectItem = vi.fn();
    renderLesson(document, {}, { event_onSelectItem: onSelectItem });

    expect(screen.getAllByRole('button', { name: 'Select item' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Select item' })[0]!);
    expect(onSelectItem).toHaveBeenCalledWith('maya');
  });
});
