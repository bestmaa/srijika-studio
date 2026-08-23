import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://srijika.com',
  integrations: [
    starlight({
      title: 'Srijika Studio',
      description:
        'Product, authoring, architecture, and engineering documentation for Srijika Studio.',
      favicon: '/favicon.png',
      head: [
        { tag: 'meta', attrs: { name: 'robots', content: 'index, follow' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://srijika.com/srijika-social.png',
          },
        },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: 'https://srijika.com/srijika-social.png',
          },
        },
      ],
      logo: {
        src: './src/assets/srijika-icon.png',
        alt: 'Srijika Studio',
      },
      customCss: ['./src/styles/docs.css'],
      components: {
        Banner: './src/components/DocsBanner.astro',
      },
      sidebar: [
        {
          label: 'Overview',
          items: [
            { label: 'Documentation', slug: 'docs' },
            { label: 'Product status', slug: 'docs/product-status' },
            { label: 'Getting started', slug: 'docs/getting-started' },
            { label: 'Using Srijika Studio', slug: 'docs/using-studio' },
            { label: 'CLI-first workflow', slug: 'docs/cli-runtime' },
            { label: 'VS Code workflow', slug: 'docs/vscode' },
            { label: 'Monorepo workflow', slug: 'docs/monorepo' },
            { label: 'React migration', slug: 'docs/react-migration' },
          ],
        },
        {
          label: 'Product model',
          items: [
            { label: 'Project anatomy', slug: 'docs/project-anatomy' },
            { label: 'Authoring model', slug: 'docs/authoring-model' },
            { label: 'Studio workflow', slug: 'docs/studio-workflow' },
          ],
        },
        {
          label: 'Engineering',
          items: [
            { label: 'Architecture', slug: 'docs/architecture' },
            { label: 'Quality contract', slug: 'docs/engineering-quality' },
            { label: 'Roadmap', slug: 'docs/roadmap' },
          ],
        },
        {
          label: 'Repository reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
  ],
});
