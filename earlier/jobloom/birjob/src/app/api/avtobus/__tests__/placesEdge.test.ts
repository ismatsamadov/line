/**
 * GET /api/avtobus/places (#720) at the edge: the pickers call it as people type, so
 * middleware must hand a browser's request to the route, and search engines must not
 * index its answers. Run through the real middleware and robots.txt.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-edge', () => ({ verifyTokenEdge: async () => null }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import robots from '@/app/robots';

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const visit = (path: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(`https://www.birjob.com${path}`, { headers: { 'user-agent': BROWSER, ...headers } }));

describe('/api/avtobus/places at the edge', () => {
  it.each(['/api/avtobus/places?q=g%C9%99nclik', '/api/avtobus/places?q=bravo&near=40.4,49.85'])(
    'reaches its route from a browser: %s', async (path) => {
      // The page's fetch() carries Sec-Fetch-Dest: empty, which the payload shield reads
      // for page paths only; /api/ is left to its own gates.
      const res = await visit(path, { 'sec-fetch-dest': 'empty' });
      expect(res.headers.get('x-middleware-next')).toBe('1');
      expect(res.status).toBe(200);
    },
  );

  it('is kept out of the index by robots.txt, with the rest of /api/', () => {
    const everyone = [robots().rules].flat().find((rule) => rule.userAgent === '*')!;
    expect(everyone.disallow).toContain('/api/');
    expect([everyone.allow].flat().some((path) => path?.startsWith('/api/avtobus'))).toBe(false);
  });
});
