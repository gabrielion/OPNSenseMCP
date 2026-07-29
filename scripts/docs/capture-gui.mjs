#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regenerates the OPNsense GUI screenshots used by the setup tutorial.
//
// Every image is a real capture of the pinned disposable OPNsense VM, never a mock-up: a
// fabricated screenshot of a security-relevant screen is subtly wrong in ways a reader cannot
// detect, and the reader trusts the picture over the prose. Re-run this after bumping
// `IMAGE_SPEC` so the images and the firmware the tests exercise never drift apart.
//
// The target is hardcoded. This tool drives an unauthenticated vendor-default login, so it must
// never be pointable at a real firewall; there is deliberately no host or credential option, and
// it refuses to run unless the repository's own managed VM is the thing listening.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_SPEC } from '../vm/product1b.mjs';
import { statusDisposableVm } from '../vm/product1b-lifecycle.mjs';
import { homedir, tmpdir } from 'node:os';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, 'docs', 'images');
const INSTANCE_ROOT = join(homedir(), 'Library/Caches/opnsense-mcp/product1b/instance');

// Disposable-lab constants. The image is the pinned unconfigured nano build, so this is the
// vendor's published default rather than a secret, and it never leaves loopback.
const ORIGIN = 'https://127.0.0.1:18443';
const LAB_USERNAME = 'root';
const LAB_PASSWORD = 'opnsense';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9412;
const VIEWPORT = { width: 1440, height: 900 };
const SETTLE_MS = 2500;
const NAVIGATION_MS = 7000;

/**
 * Alt text states what the reader should be SEEING, not what the file is called: it is what keeps
 * the document usable when an image fails to load, is read aloud, or has drifted from a newer
 * release. Every menu path here is also written in the tutorial as copyable text, so no
 * information exists only as pixels.
 */
const SHOTS = Object.freeze([
  {
    name: '01-login',
    path: '/',
    alt: 'The OPNsense sign-in page, with the Username and Password fields and the Login button.',
    caption: 'Sign in to your firewall.'
  },
  {
    name: '02-users',
    path: '/ui/auth/user',
    alt: 'System: Access: Users, listing existing accounts, with the Users and ApiKeys tabs above the table and the orange + button below it.',
    caption: 'System > Access > Users. The + button below the table adds an account.'
  },
  {
    name: '03-privileges',
    path: '/ui/auth/priv',
    alt: 'System: Access: Privileges, showing the searchable list of privilege names that can be granted to an account.',
    caption: 'System > Access > Privileges. Grant only the three read-only privileges.'
  },
  {
    name: '04-apikeys',
    path: '/ui/auth/user',
    // The tabs are rendered client-side, so a `#apikeys` fragment silently captures the Users
    // tab again. The tab must be clicked and the switch confirmed, or this image would be a
    // duplicate that looks plausible and documents the wrong screen.
    // Both selectors are scoped to ul.nav-tabs. An unscoped `li.active` matches the sidebar
    // menu, where "Users" is legitimately active, so the check would report failure even after a
    // successful switch.
    prepare: `(() => {
      const tab = document.querySelector('ul.nav-tabs a[href="#apikeys"]');
      if (!tab) return 'no apikeys tab';
      tab.click();
      return 'clicked';
    })()`,
    confirm: `(() => {
      const active = document.querySelector('ul.nav-tabs li.active > a');
      return active === null ? '' : active.textContent.trim().toLowerCase();
    })()`,
    expect: 'apikeys',
    alt: 'The ApiKeys tab of System: Access: Users, showing an empty table with Username, Api key and Commands columns. The tab lists issued keys only; it has no button that creates one.',
    caption:
      'The ApiKeys tab lists existing keys. It does not create them — keys are issued from the user’s own edit form.'
  },
  // NOT CAPTURED YET, and the tutorial says so in words rather than showing an approximation:
  // the user edit dialog holding the API key control. Its row buttons are rendered
  // asynchronously by Bootgrid with no stable hook, so no selector here proved reliable. A
  // screenshot that intermittently captures the wrong screen is worse than an honest sentence,
  // so the tutorial documents this step as text until a dependable selector exists.
  {
    name: '05-certificates',
    path: '/ui/trust/cert',
    alt: 'System: Trust: Certificates, listing the certificates held by the firewall, including the self-signed web GUI certificate, with per-row export controls.',
    caption: 'System > Trust > Certificates. Export the web GUI certificate as PEM.'
  }
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), {
      once: true
    });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });
  return {
    socket,
    send: (method, parameters = {}) =>
      new Promise((resolve) => {
        const id = (nextId += 1);
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params: parameters }));
      })
  };
}

async function main() {
  const state = await statusDisposableVm({ instanceRoot: INSTANCE_ROOT }).catch(() => undefined);
  if (state?.state !== 'running') {
    fail('The managed disposable VM is not running. Start it with: npm run vm:start');
  }

  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  // The browser profile lives outside the repository: Chrome keeps writing to it after the
  // debugging socket closes, so leaving it under docs/images/ both pollutes the tracked tree and
  // makes the cleanup race.
  const profile = await mkdtemp(join(tmpdir(), 'opnsense-mcp-capture-'));

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      // The disposable VM presents a self-signed certificate by design; this switch applies to
      // this throwaway browser process only and never to the MCP server's own TLS policy.
      '--ignore-certificate-errors',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let target;
  for (let attempt = 0; attempt < 40 && target === undefined; attempt += 1) {
    await sleep(250);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = targets.find((entry) => entry.type === 'page')?.webSocketDebuggerUrl;
    } catch {
      // Chrome has not opened its debugging port yet.
    }
  }
  if (target === undefined) {
    chrome.kill();
    fail('Chrome did not expose a debugging target. Set CHROME_PATH if Chrome is elsewhere.');
  }

  const { socket, send } = await connect(target);
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
      ?.result?.value;

  await send('Page.enable');
  await send('Runtime.enable');

  const captured = [];
  try {
    for (const shot of SHOTS) {
      await send('Page.navigate', { url: `${ORIGIN}${shot.path}` });
      await sleep(shot.name === '01-login' ? SETTLE_MS : NAVIGATION_MS);

      // The sign-in page is captured first, unauthenticated, then used to authenticate. The
      // submit BUTTON must be clicked rather than the form submitted: OPNsense keys off the
      // button's own name/value pair, which a programmatic submit() does not send.
      if (shot.name === '01-login') {
        await send('Page.captureScreenshot', { format: 'png' }).then(async ({ data }) => {
          await writeFile(join(OUTPUT_DIRECTORY, `${shot.name}.png`), Buffer.from(data, 'base64'));
        });
        captured.push(shot);
        const outcome = await evaluate(`(() => {
          const form = document.querySelector('form');
          if (!form) return 'no form';
          form.querySelector('#usernamefld').value = ${JSON.stringify(LAB_USERNAME)};
          form.querySelector('#passwordfld').value = ${JSON.stringify(LAB_PASSWORD)};
          const button = form.querySelector('button[type=submit], input[type=submit]');
          if (!button) return 'no submit button';
          button.click();
          return 'ok';
        })()`);
        if (outcome !== 'ok') throw new Error(`Sign-in failed: ${String(outcome)}`);
        await sleep(NAVIGATION_MS);
        const title = await evaluate('document.title');
        if (typeof title !== 'string' || title.startsWith('Login')) {
          throw new Error('Sign-in did not leave the login page');
        }
        continue;
      }

      const title = await evaluate('document.title');
      if (typeof title !== 'string' || title.startsWith('Login')) {
        throw new Error(`Session lost before ${shot.name}`);
      }
      if (shot.prepare !== undefined) {
        const outcome = await evaluate(shot.prepare);
        if (outcome !== 'clicked') throw new Error(`${shot.name}: ${String(outcome)}`);
        await sleep(SETTLE_MS);
        const observed = await evaluate(shot.confirm);
        if (observed !== shot.expect) {
          throw new Error(`${shot.name}: expected ${shot.expect}, saw ${String(observed)}`);
        }
      }
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(OUTPUT_DIRECTORY, `${shot.name}.png`), Buffer.from(data, 'base64'));
      captured.push({ ...shot, title });
      process.stdout.write(`captured ${shot.name}.png  (${title})\n`);
    }

    // The manifest stamps the firmware and the capture date so a reader on a later release can
    // tell whether the pixels still describe their system.
    await writeFile(
      join(OUTPUT_DIRECTORY, 'manifest.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          firmware: { name: 'OPNsense', release: IMAGE_SPEC.release },
          capturedAt: new Date().toISOString().slice(0, 10),
          viewport: VIEWPORT,
          images: captured.map(({ name, path, alt, caption }) => ({
            file: `${name}.png`,
            path,
            alt,
            caption
          }))
        },
        null,
        2
      )}\n`
    );
  } finally {
    socket.close();
    chrome.kill();
    // Wait for the browser to exit before touching its profile, and never let a cleanup failure
    // replace the real error: Chrome keeps writing extension storage after the socket closes, so
    // an eager rm throws ENOTEMPTY and masks whatever actually went wrong.
    await new Promise((resolve) => {
      chrome.once('exit', resolve);
      setTimeout(resolve, 5000).unref?.();
    });
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
  process.stdout.write(`\n${captured.length} images written to docs/images/\n`);
}

await main();
