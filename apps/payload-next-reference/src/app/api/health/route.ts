import { getPayload } from 'payload';

import config from '../../../payload.config';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const payload = await getPayload({ config });
    await payload.find({
      collection: 'posts',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
    });
    return Response.json({ status: 'ready' }, { status: 200 });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
