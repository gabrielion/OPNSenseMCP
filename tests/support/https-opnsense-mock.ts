// SPDX-License-Identifier: AGPL-3.0-or-later
import { Buffer } from 'node:buffer';
import { createServer, type Server } from 'node:https';
import { once } from 'node:events';
import { generate } from 'selfsigned';

export interface RecordedHttpsRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: string;
}

export interface SyntheticOPNsenseTarget {
  readonly url: string;
  readonly ca: string;
  readonly requests: readonly RecordedHttpsRequest[];
  close(): Promise<void>;
}

export interface SyntheticOPNsenseResponse {
  readonly statusCode?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly delayMs?: number;
}

export type SyntheticOPNsenseHandler = (
  request: RecordedHttpsRequest
) => SyntheticOPNsenseResponse | Promise<SyntheticOPNsenseResponse>;

export async function startSyntheticOPNsenseTarget(
  handler: SyntheticOPNsenseHandler
): Promise<SyntheticOPNsenseTarget> {
  const certificate = await generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    keyType: 'ec',
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyCertSign: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  });
  const requests: RecordedHttpsRequest[] = [];
  const server: Server = createServer({ key: certificate.private, cert: certificate.cert });
  server.on('request', (request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      const recorded = Object.freeze({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: Object.freeze({ ...request.headers }),
        body: Buffer.concat(chunks).toString('utf8')
      });
      requests.push(recorded);
      const synthetic = await handler(recorded);
      const send = () => {
        if (response.destroyed) return;
        response.writeHead(synthetic.statusCode ?? 200, {
          'content-type': 'application/json',
          ...synthetic.headers
        });
        response.end(synthetic.body ?? '{}');
      };
      if (synthetic.delayMs === undefined) send();
      else setTimeout(send, synthetic.delayMs).unref();
    })().catch(() => {
      if (!response.destroyed) response.destroy();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Mock target failed');
  let closeSettlement: Promise<void> | undefined;
  return Object.freeze({
    url: `https://127.0.0.1:${String(address.port)}`,
    ca: certificate.cert,
    requests,
    close() {
      closeSettlement ??= new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      });
      return closeSettlement;
    }
  });
}
