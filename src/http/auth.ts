// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { RequestHandler } from 'express';

interface AuthenticatedRequest {
  auth?: AuthInfo;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function createLocalBearerAuthentication(expectedToken: string): RequestHandler {
  const expectedDigest = sha256(expectedToken);

  return (request, response, next) => {
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string' ? /^Bearer ([^\s,]+)$/iu.exec(authorization) : null;
    const suppliedDigest = sha256(match?.[1] ?? '');
    const authenticated = match !== null && timingSafeEqual(expectedDigest, suppliedDigest);

    if (!authenticated) {
      response.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }

    (request as AuthenticatedRequest).auth = {
      token: expectedToken,
      clientId: 'http:local-bearer',
      scopes: []
    };
    next();
  };
}
