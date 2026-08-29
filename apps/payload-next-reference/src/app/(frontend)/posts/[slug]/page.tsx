import { notFound } from 'next/navigation';

import { PostDetailUI } from '../../../../features/posts/PostDetail.ui';
import { findPostBySlug } from '../../../../server/posts';

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await findPostBySlug(slug);
  if (!post) notFound();
  return (
    <main>
      <PostDetailUI post={post} />
    </main>
  );
}
