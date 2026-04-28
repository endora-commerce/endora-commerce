import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie } from '../../../lib/session';

export async function GET(req: NextRequest): Promise<Response> {
  await clearSessionCookie();
  const next = req.nextUrl.searchParams.get('next') ?? '/account';
  const url = new URL(`/login?next=${encodeURIComponent(next)}`, req.url);
  return NextResponse.redirect(url);
}
