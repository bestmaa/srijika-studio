import Link from 'next/link';

import type { PostSummary } from '../../server/posts';

export function PostDetailUI({ post }: { post: PostSummary }) {
  return (
    <article>
      <Link href="/">Back to posts</Link>
      <h1>{post.title}</h1>
      <p>{post.summary}</p>
    </article>
  );
}
