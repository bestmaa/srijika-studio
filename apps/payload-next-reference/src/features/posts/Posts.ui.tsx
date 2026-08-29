import Link from 'next/link';

import type { PostSummary } from '../../server/posts';

export interface PostsUIProps {
  post: PostSummary;
}

export function PostsUI(props: PostsUIProps) {
  return (
    <article>
      <h2>{props.post.title}</h2>
      <p>{props.post.summary}</p>
      <Link href={`/posts/${props.post.slug}`}>{props.post.title}</Link>
    </article>
  );
}
