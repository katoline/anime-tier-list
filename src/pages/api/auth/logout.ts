import type { APIRoute } from 'astro';
import { destroySession } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies, url, redirect }) => {
  await destroySession(cookies, url);
  return redirect('/', 303);
};
