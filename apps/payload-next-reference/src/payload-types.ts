export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Media {
  id: string;
  alt: string;
  url?: string | null;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  summary: string;
  hero?: string | Media | null;
  _status?: 'draft' | 'published' | null;
}
