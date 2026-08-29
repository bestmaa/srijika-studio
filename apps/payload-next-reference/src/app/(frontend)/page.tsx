import { PostEditorConnector } from '../../features/posts/PostEditor.connector';
import { PostsUI } from '../../features/posts/Posts.ui';
import { listPublishedPosts } from '../../server/posts';

export default async function HomePage() {
  const posts = await listPublishedPosts();
  return (
    <main>
      <section aria-labelledby="posts-title">
        <h1 id="posts-title">Payload + Next.js reference</h1>
        <p>Content is loaded server-side and crosses into pure UI as serializable props.</p>
        <ul>
          {posts.map((post) => (
            <li key={post.id}>
              <PostsUI post={post} />
            </li>
          ))}
        </ul>
      </section>
      <PostEditorConnector />
    </main>
  );
}
