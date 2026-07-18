// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { RequestHandler } from 'express';

interface AuthenticatedRequest {
  auth?: AuthInfo;
}

interface LocalBearerCrypto {
  sha256(value: string): Uint8Array;
  timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
}

const SYSTEM_CRYPTO: LocalBearerCrypto = Object.freeze({
  sha256: (value: string) => createHash('sha256').update(value, 'utf8').digest(),
  timingSafeEqual
});

function authorizationLines(rawHeaders: readonly string[]): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'authorization') {
      values.push(rawHeaders[index + 1] ?? '');
    }
  }
  return values;
}

function removeAuthorization(request: Parameters<RequestHandler>[0]): void {
  const distinct = request.headersDistinct;
  delete distinct.authorization;
  delete request.headers.authorization;
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      request.rawHeaders.splice(index, 2);
    }
  }
}

export function createLocalBearerAuthentication(
  expectedToken: string,
  crypto: LocalBearerCrypto = SYSTEM_CRYPTO
): RequestHandler {
  const expectedDigest = crypto.sha256(expectedToken);

  return (request, response, next) => {
    const lines = authorizationLines(request.rawHeaders);
    const authorization = lines.length === 1 ? lines[0] : undefined;
    const match =
      typeof authorization === 'string' ? /^Bearer ([^\s,]+)$/iu.exec(authorization) : null;
    const suppliedDigest = crypto.sha256(match?.[1] ?? '');
    const digestMatches = crypto.timingSafeEqual(expectedDigest, suppliedDigest);
    const authenticated = lines.length === 1 && match !== null && digestMatches;

    if (!authenticated) {
      response.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }

    (request as AuthenticatedRequest).auth = {
      token: expectedToken,
      clientId: 'http:local-bearer',
      scopes: []
    };
    removeAuthorization(request);
    next();
  };
}
