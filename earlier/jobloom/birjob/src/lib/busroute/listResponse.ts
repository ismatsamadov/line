/**
 * The planner's stop, bus and line lists, answered with a validator (#743). A browser keeps
 * each answer but asks the server before every use (no-cache), sending the tag of what it
 * kept. The server works the list out again and answers 304, with no body, when the tag is
 * still the list's, or 200 with the list when it is not. So no list outlives a deploy that
 * changes it, as with no-store, and a returning visitor gets a 304 instead of the stops'
 * 87 KB.
 *
 * Until #743 the lists sent s-maxage with stale-while-revalidate and no max-age, for
 * Vercel's edge. Cloudflare keeps nothing under /api/ (docs/owner-actions.md §2), so the
 * browser held the only copy, and after a deploy showed it once more while it asked again.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * A weak entity tag for a body: its SHA-256, base64url, quoted, after W/. Weak, because a
 * strong one does not come back as sent: Caddy appends its encoding to a strong tag
 * (`"…-gzip"`) and, up to v2.11.7, takes it off If-None-Match again only while the tag is
 * still strong, and Cloudflare marks a strong tag W/ when it compresses an answer again. So
 * the browser sent back W/"…-gzip" and got the whole list. Neither touches a weak tag, and
 * If-None-Match compares weakly anyway.
 */
export const entityTag = (body: string): string => `W/"${createHash("sha256").update(body).digest("base64url")}"`;

/**
 * Whether an If-None-Match header names `tag`, by the weak comparison RFC 9110 asks for
 * there, so W/ on either side does not count. A tag that comes back with Caddy's
 * `-gzip` or `-zstd` still on it matches too. The header can list several tags, or be *,
 * which any current list matches.
 */
export function noneMatch(header: string | null, tag: string): boolean {
  if (!header) return false;
  const opaque = tag.replace(/^W\//, "");
  return header.split(",").some((candidate) => {
    const each = candidate.trim().replace(/^W\//, "");
    return each === "*" || each === opaque || each.replace(/-(gzip|zstd)"$/, '"') === opaque;
  });
}

/** The list as JSON with its tag, or 304 with the tag alone when the browser has it. */
export function listResponse(request: Request, body: unknown): NextResponse {
  const json = JSON.stringify(body);
  const headers = { "Cache-Control": "no-cache", ETag: entityTag(json) };
  if (noneMatch(request.headers.get("if-none-match"), headers.ETag)) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(json, { headers: { ...headers, "Content-Type": "application/json" } });
}
