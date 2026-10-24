import 'server-only';

import { headers } from 'next/headers';

import { getEnv } from '@/lib/env';
import { isSecureBaseUrl, resolveBaseUrl } from '@/lib/origins';

/**
 * Base URL for the current request, for absolute links shown to the user.
 *
 * Reads APP_BASE_URL plus APP_EXTRA_ORIGINS and picks whichever allowed origin
 * the browser actually used. That way the agent quick-start commands and the
 * OpenAPI `servers` entry work the same when you open the app by LAN IP or by
 * a Tailscale name, instead of sending you to an unreachable host.
 */
export async function getBaseUrl(): Promise<string> {
  const requestHeaders = await headers();
  const env = getEnv();

  return resolveBaseUrl({
    canonical: env.APP_BASE_URL,
    // x-forwarded-host first: behind a reverse proxy the Host header is the
    // proxy's, and the original one travels in this header.
    host: requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
    proto: requestHeaders.get('x-forwarded-proto'),
    extra: env.APP_EXTRA_ORIGINS.join(','),
  });
}

/**
 * Secure-cookie decision, per request.
 *
 * It cannot be read from APP_BASE_URL alone: the same installation may be
 * plain HTTP on the LAN and HTTPS through a Tailscale funnel, and a `Secure`
 * cookie sent over HTTP is silently dropped by the browser.
 */
export async function isSecureRequest(): Promise<boolean> {
  return isSecureBaseUrl(await getBaseUrl());
}
