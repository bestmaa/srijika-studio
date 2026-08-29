import type { FrameworkComponentManifest } from '@srijika/component-registry';
import { describe, expect, it } from 'vitest';

import { analyzeSrijikaNextBoundary, compileSrijikaTsx } from './index';

describe('Next.js framework primitives', () => {
  it('compiles Link and Image through deterministic safe core previews', () => {
    const source = `import Link from 'next/link';
import Image from 'next/image';

interface HeroProps {
  href: string;
  imageSrc: string;
}

export function HeroUI(props: HeroProps) {
  return (
    <main>
      <Link href={props.href} prefetch={false}>Read more</Link>
      <Image src={props.imageSrc} alt="Preview" width={640} height={360} priority />
    </main>
  );
}
`;
    const result = compileSrijikaTsx('Hero.ui.tsx', source);

    expect(result.diagnostics).toEqual([]);
    expect(result.framework).toMatchObject({ boundary: 'server', directives: [] });
    expect(
      result.framework.primitives.map(({ componentId, localName }) => ({ componentId, localName })),
    ).toEqual([
      { componentId: 'srijika.next.link', localName: 'Link' },
      { componentId: 'srijika.next.image', localName: 'Image' },
    ]);
    expect(result.document).not.toBeNull();
    const link = Object.values(result.document!.nodes).find(
      (node) => node.kind === 'element' && node.name === 'Next Link',
    );
    const image = Object.values(result.document!.nodes).find(
      (node) => node.kind === 'element' && node.name === 'Next Image',
    );
    expect(link).toMatchObject({
      kind: 'element',
      componentId: 'srijika.container',
      props: { as: { kind: 'literal', value: 'a' } },
      instanceProps: { href: { type: 'string' } },
    });
    expect(image).toMatchObject({
      kind: 'element',
      componentId: 'srijika.image',
      instanceProps: { width: { type: 'number' }, height: { type: 'number' } },
    });
    const linkSpan = result.sourceMap.nodes[result.framework.primitives[0]!.nodeIds[0]!];
    expect(source.slice(linkSpan!.start, linkSpan!.end)).toContain('<Link');
  });

  it('treats use client as boundary metadata instead of a visual node', () => {
    const result = compileSrijikaTsx(
      'Navigation.ui.tsx',
      `'use client';
import Link from 'next/link';
export function NavigationUI() {
  return <Link href="/docs">Docs</Link>;
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.framework).toMatchObject({ boundary: 'client', directives: ['use client'] });
    expect(Object.keys(result.document!.nodes)).toEqual(['root_0_text', 'root']);
  });

  it('fails closed for unsupported imports, dynamic loading, props, and Image dimensions', () => {
    const unsupported = compileSrijikaTsx(
      'Bad.ui.tsx',
      `import { Image } from 'next/image';
const deferred = () => import('next/link');
export function BadUI() { return <Image src="/bad.png" unknown="x" />; }`,
    );
    expect(unsupported.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['SRIJIKA5001', 'SRIJIKA5002', 'SRIJIKA2001']),
    );

    const invalidImage = compileSrijikaTsx(
      'Image.ui.tsx',
      `import Image from 'next/image';
export function ImageUI() { return <Image src="/photo.jpg" alt="Photo" />; }`,
    );
    expect(invalidImage.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'SRIJIKA5003',
        message: 'Next Image requires both width and height unless fill is present.',
      }),
    );
  });

  it('accepts only explicitly registered project-local presentational components', () => {
    const card: FrameworkComponentManifest = {
      id: 'project.shared.card',
      version: 1,
      moduleSpecifier: './Card',
      exportName: 'Card',
      displayName: 'Shared Card',
      props: {
        title: { type: 'string', required: true, previewProp: 'ariaLabel' },
      },
      children: 'optional',
      preview: { kind: 'container', element: 'section' },
      source: 'project',
    };
    const source = `import { Card } from './Card';
export function HomeUI() { return <Card title="Account">Overview</Card>; }`;

    expect(compileSrijikaTsx('Home.ui.tsx', source).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SRIJIKA2001' }),
    );
    const registered = compileSrijikaTsx('Home.ui.tsx', source, { projectComponents: [card] });
    expect(registered.diagnostics).toEqual([]);
    expect(registered.framework.primitives[0]).toMatchObject({
      adapterId: 'srijika.project-components',
      componentId: 'project.shared.card',
    });
  });
});

describe('Next.js server/client boundaries', () => {
  const span = { start: 0, end: 1, line: 1, column: 1 };
  const cardContract = [
    {
      kind: 'prop' as const,
      name: 'title',
      required: true,
      typeSource: 'string',
      span,
      valueShape: { kind: 'string' as const },
    },
    {
      kind: 'event' as const,
      name: 'onOpen',
      required: false,
      typeSource: '() => void',
      span,
      eventSignature: { payload: null },
    },
  ];

  it('recognizes page/layout composition without compiling routes as UI owners', () => {
    const page = analyzeSrijikaNextBoundary(
      'src/app/page.tsx',
      `import { CardUI } from '../features/card/Card.ui';
export default function Page() { return <CardUI title="Account" />; }`,
      {
        resolvedUiComponents: [
          {
            specifier: '../features/card/Card.ui',
            exportName: 'CardUI',
            componentName: 'CardUI',
            contract: cardContract,
          },
        ],
      },
    );
    const layout = analyzeSrijikaNextBoundary(
      'src/app/layout.tsx',
      `export default function Layout(props: { children: React.ReactNode }) {
  return <html><body>{props.children}</body></html>;
}`,
    );

    expect(page).toMatchObject({
      boundary: 'server',
      routeKind: 'page',
      diagnostics: [],
      resolvedUiComponents: ['CardUI'],
    });
    expect(layout).toMatchObject({ boundary: 'server', routeKind: 'layout', diagnostics: [] });
  });

  it('reports targeted server behavior and non-serializable prop diagnostics', () => {
    const result = analyzeSrijikaNextBoundary(
      'src/app/page.tsx',
      `import { useState } from 'react';
import { CardUI } from '../features/card/Card.ui';
export default function Page() {
  const [open] = useState(false);
  return <CardUI title={window.location.href} onOpen={() => open} />;
}`,
      {
        resolvedUiComponents: [
          {
            specifier: '../features/card/Card.ui',
            exportName: 'CardUI',
            componentName: 'CardUI',
            contract: cardContract,
          },
        ],
      },
    );

    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['SRIJIKA5004', 'SRIJIKA5005']),
    );
    expect(result.diagnostics.find(({ code }) => code === 'SRIJIKA5004')?.message).toContain(
      'Server Component',
    );
    expect(
      result.diagnostics.some(
        ({ code, message }) => code === 'SRIJIKA5004' && message.includes('window'),
      ),
    ).toBe(true);
  });

  it('tracks aliased React namespaces without treating object properties as browser globals', () => {
    const invalid = analyzeSrijikaNextBoundary(
      'src/app/page.tsx',
      `import * as UI from 'react';
export default function Page() { UI.useState(false); return <div />; }`,
    );
    const valid = analyzeSrijikaNextBoundary(
      'src/app/page.tsx',
      `const server = { window: 'label' };
export default function Page() { return <div>{server.window}</div>; }`,
    );

    expect(
      invalid.diagnostics.some(
        ({ code, message }) => code === 'SRIJIKA5004' && message.includes('UI.useState'),
      ),
    ).toBe(true);
    expect(valid.diagnostics).toEqual([]);
  });

  it('allows client behavior behind an explicit use client boundary', () => {
    const result = analyzeSrijikaNextBoundary(
      'src/app/client.tsx',
      `'use client';
import { useState } from 'react';
export function ClientPanel() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(!open)}>Toggle</button>;
}`,
    );

    expect(result).toMatchObject({ boundary: 'client', diagnostics: [] });
  });

  it('rejects Payload Local API and database runtime imports from UI and client boundaries', () => {
    const ui = compileSrijikaTsx(
      'Post.ui.tsx',
      `import type { Post } from '../payload-types';
import { getPayload } from 'payload';
export function PostUI(props: { post: Post }) { return <article>{props.post.title}</article>; }`,
      {
        resolvedTypeModules: [
          {
            specifier: '../payload-types',
            fileName: 'src/payload-types.ts',
            source: 'export interface Post { title: string }',
          },
        ],
      },
    );
    const client = analyzeSrijikaNextBoundary(
      'src/features/posts/Posts.connector.tsx',
      `'use client';
import postgres from 'postgres';
export function PostsConnector() { return <button>Save</button>; }`,
    );

    expect(ui.diagnostics.find(({ code }) => code === 'SRIJIKA5006')?.message).toContain(
      'serializable props',
    );
    expect(client.diagnostics.find(({ code }) => code === 'SRIJIKA5006')?.message).toContain(
      'REST or GraphQL',
    );
  });
});
