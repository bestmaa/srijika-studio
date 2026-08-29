export interface PostMutation {
  title: string;
  slug: string;
  summary: string;
  _status: 'draft' | 'published';
}

export async function mutatePost(
  input: PostMutation,
  options: { id?: string; token?: string },
): Promise<{ id: string }> {
  const response = await fetch(options.id ? `/api/posts/${options.id}` : '/api/posts', {
    method: options.id ? 'PATCH' : 'POST',
    credentials: 'include',
    headers: {
      ...(options.token ? { Authorization: `JWT ${options.token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Payload mutation failed with ${response.status}.`);
  const result = (await response.json()) as { doc?: { id?: string }; id?: string };
  const id = result.doc?.id ?? result.id;
  if (!id) throw new Error('Payload mutation did not return an id.');
  return { id };
}

export async function mutatePostWithGraphQL(input: PostMutation, token: string): Promise<string> {
  const response = await fetch('/api/graphql', {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation CreatePost($data: mutationPostInput!) { createPost(data: $data) { id } }',
      variables: { data: input },
    }),
  });
  if (!response.ok) throw new Error(`Payload GraphQL mutation failed with ${response.status}.`);
  const result = (await response.json()) as { data?: { createPost?: { id?: string } } };
  const id = result.data?.createPost?.id;
  if (!id) throw new Error('Payload GraphQL mutation did not return an id.');
  return id;
}
