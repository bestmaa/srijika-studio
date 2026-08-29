'use client';

import { useState } from 'react';

import { mutatePost, type PostMutation } from './posts.api';

const emptyPost: PostMutation = { title: '', slug: '', summary: '', _status: 'draft' };

export function PostEditorConnector({ authToken }: { authToken?: string }) {
  const [post, setPost] = useState(emptyPost);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');

  async function save() {
    setStatus('Saving');
    try {
      const result = await mutatePost(post, {
        ...(savedId ? { id: savedId } : {}),
        ...(authToken ? { token: authToken } : {}),
      });
      setSavedId(result.id);
      setStatus(savedId ? 'Updated' : 'Created');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section aria-labelledby="editor-title">
      <h2 id="editor-title">Authenticated REST create/update</h2>
      <label>
        Title
        <input
          value={post.title}
          onChange={(event) => setPost({ ...post, title: event.currentTarget.value })}
        />
      </label>
      <label>
        Slug
        <input
          value={post.slug}
          onChange={(event) => setPost({ ...post, slug: event.currentTarget.value })}
        />
      </label>
      <label>
        Summary
        <textarea
          value={post.summary}
          onChange={(event) => setPost({ ...post, summary: event.currentTarget.value })}
        />
      </label>
      <button type="button" onClick={() => void save()}>
        {savedId ? 'Update draft' : 'Create draft'}
      </button>
      <output aria-live="polite">{status}</output>
    </section>
  );
}
