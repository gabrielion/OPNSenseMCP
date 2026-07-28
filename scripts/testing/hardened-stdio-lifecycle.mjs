// SPDX-License-Identifier: AGPL-3.0-or-later
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { validateInstalledInvocation } from './installed-invocation.mjs';

const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;
const DEFAULT_STDERR_LIMIT_BYTES = 1024 * 1024;

const DEFAULT_SDK_FACTORIES = Object.freeze({
  createTransport: (options) => new StdioClientTransport(options),
  createClient: (clientInfo, options) => new Client(clientInfo, options)
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimeout(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function pinnedStdioChildProcess(transport) {
  const child = isRecord(transport) ? transport._process : undefined;
  if (
    !isRecord(child) ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 0 ||
    typeof child.once !== 'function' ||
    typeof child.off !== 'function' ||
    typeof child.kill !== 'function' ||
    !(child.exitCode === null || Number.isSafeInteger(child.exitCode)) ||
    !(child.signalCode === null || typeof child.signalCode === 'string')
  ) {
    throw new Error('Invalid installed child process');
  }
  return child;
}

function observeProcessClose(child) {
  let closeListener;
  const settlement = new Promise((resolve) => {
    closeListener = (code, signal) => {
      resolve(Object.freeze({ code, signal }));
    };
    child.once('close', closeListener);
  });
  return Object.freeze({
    settlement,
    cleanup: () => child.off('close', closeListener)
  });
}

function rejectOnAbort(signal) {
  let abortListener;
  const settlement = new Promise((_, reject) => {
    abortListener = () => reject(new Error('Installed operation aborted'));
    if (signal.aborted) {
      abortListener();
      return;
    }
    signal.addEventListener('abort', abortListener, { once: true });
  });
  return Object.freeze({
    settlement,
    cleanup: () => signal.removeEventListener('abort', abortListener)
  });
}

async function boundedBySignal(settlement, signal) {
  const abort = rejectOnAbort(signal);
  try {
    return await Promise.race([settlement, abort.settlement]);
  } finally {
    abort.cleanup();
  }
}

async function boundedByTimeout(settlement, timeoutMs) {
  let deadline;
  try {
    return await Promise.race([
      settlement,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Installed close timed out')), timeoutMs);
        deadline.unref?.();
      })
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Runs one installed MCP stdio session through the fail-closed lifecycle shared by the VM runners.
 * The private `_process` access is an intentionally pinned SDK boundary: the public transport only
 * exposes a pid, while the evidence path must retain the exact ChildProcess and inspect its outcome.
 */
export async function runHardenedStdioLifecycle(
  {
    invocation,
    environment,
    signal = new AbortController().signal,
    clientInfo,
    clientOptions,
    configureClient = () => undefined,
    sdkFactories = DEFAULT_SDK_FACTORIES,
    operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    stderrLimitBytes = DEFAULT_STDERR_LIMIT_BYTES,
    failureMessage = 'Installed MCP lifecycle failed'
  },
  operation
) {
  if (
    !validTimeout(operationTimeoutMs) ||
    !validTimeout(closeTimeoutMs) ||
    !Number.isSafeInteger(stderrLimitBytes) ||
    stderrLimitBytes < 0 ||
    typeof operation !== 'function' ||
    typeof configureClient !== 'function' ||
    typeof failureMessage !== 'string' ||
    failureMessage.length === 0
  ) {
    throw new Error(failureMessage);
  }

  const operationController = new AbortController();
  const operationSignal = operationController.signal;
  const abortFromParent = () => operationController.abort();
  signal.addEventListener('abort', abortFromParent, { once: true });
  if (signal.aborted) operationController.abort();
  const operationDeadline = setTimeout(() => operationController.abort(), operationTimeoutMs);
  operationDeadline.unref?.();

  let stderr;
  let stderrBytes = 0;
  let stderrOverflow = false;
  let stderrFailed = false;
  let processCloseObserver;
  let installedChild;
  let client;
  let closeClient = async () => undefined;
  let diagnosticsClean = () => false;
  let removeAbortListener = () => undefined;
  let removeStderrListeners = () => undefined;
  let result;
  let failed = operationSignal.aborted;

  try {
    const validatedInvocation = validateInstalledInvocation(invocation);
    const transport = sdkFactories.createTransport({
      command: validatedInvocation.command,
      args: [...validatedInvocation.arguments],
      cwd: validatedInvocation.cwd,
      env: environment,
      stderr: 'pipe',
      maxBufferSize: stderrLimitBytes
    });
    client = sdkFactories.createClient(clientInfo, clientOptions);
    configureClient(client);

    stderr = transport.stderr;
    stderrFailed =
      stderr === null ||
      typeof stderr?.on !== 'function' ||
      typeof stderr?.once !== 'function' ||
      typeof stderr?.off !== 'function';

    const originalStart = transport.start.bind(transport);
    transport.start = async () => {
      await originalStart();
      installedChild = pinnedStdioChildProcess(transport);
      processCloseObserver = observeProcessClose(installedChild);
    };

    const originalTransportClose = transport.close.bind(transport);
    let transportCloseSettlement;
    transport.close = () => {
      transportCloseSettlement ??= Promise.resolve().then(originalTransportClose);
      return transportCloseSettlement;
    };

    const originalClientClose = client.close.bind(client);
    let clientCloseSettlement;
    closeClient = () => {
      clientCloseSettlement ??= Promise.resolve().then(originalClientClose);
      return clientCloseSettlement;
    };
    client.close = closeClient;

    const observeStderr = (chunk) => {
      if (stderrOverflow) return;
      try {
        stderrBytes = Math.min(stderrLimitBytes + 1, stderrBytes + Buffer.byteLength(chunk));
      } catch {
        stderrFailed = true;
      }
      if (stderrBytes > stderrLimitBytes || stderrFailed) {
        stderrOverflow = true;
        operationController.abort();
        void closeClient().catch(() => undefined);
      }
    };
    const observeStderrFailure = () => {
      stderrFailed = true;
      operationController.abort();
      void closeClient().catch(() => undefined);
    };
    if (!stderrFailed) {
      stderr.on('data', observeStderr);
      stderr.once('error', observeStderrFailure);
      removeStderrListeners = () => {
        stderr.off('data', observeStderr);
        stderr.off('error', observeStderrFailure);
      };
    }
    diagnosticsClean = () => stderrBytes === 0 && !stderrOverflow && !stderrFailed;

    const abortClient = () => {
      void closeClient().catch(() => undefined);
    };
    operationSignal.addEventListener('abort', abortClient, { once: true });
    removeAbortListener = () => operationSignal.removeEventListener('abort', abortClient);

    const requestOptions = Object.freeze({
      signal: operationSignal,
      timeout: operationTimeoutMs,
      maxTotalTimeout: operationTimeoutMs
    });
    await boundedBySignal(client.connect(transport, requestOptions), operationSignal);
    if (operationSignal.aborted) throw new Error('Installed operation aborted');

    const hardenedClient = Object.freeze({
      listTools: () =>
        boundedBySignal(client.listTools(undefined, requestOptions), operationSignal),
      callTool: (request) =>
        boundedBySignal(client.callTool(request, requestOptions), operationSignal),
      diagnosticsClean
    });
    result = await boundedBySignal(
      Promise.resolve().then(() => operation(hardenedClient)),
      operationSignal
    );
    if (operationSignal.aborted) failed = true;
  } catch {
    failed = true;
  } finally {
    clearTimeout(operationDeadline);
    signal.removeEventListener('abort', abortFromParent);
    removeAbortListener();

    let processOutcome;
    try {
      const closeSettlement = closeClient();
      if (processCloseObserver === undefined) {
        await boundedByTimeout(closeSettlement, closeTimeoutMs);
        failed = true;
      } else {
        [processOutcome] = await boundedByTimeout(
          Promise.all([processCloseObserver.settlement, closeSettlement]),
          closeTimeoutMs
        );
      }
    } catch {
      failed = true;
      if (processCloseObserver !== undefined && installedChild !== undefined) {
        try {
          if (installedChild.exitCode === null && installedChild.signalCode === null) {
            if (installedChild.kill('SIGKILL') !== true) {
              failed = true;
            }
          }
          processOutcome = await boundedByTimeout(processCloseObserver.settlement, closeTimeoutMs);
        } catch {
          failed = true;
        }
      }
    } finally {
      processCloseObserver?.cleanup();
      removeStderrListeners();
    }

    if (
      processOutcome === undefined ||
      processOutcome.code !== 0 ||
      processOutcome.signal !== null
    ) {
      failed = true;
    }
    if (signal.aborted) failed = true;
    if (diagnosticsClean() !== true) failed = true;
  }

  if (failed || result === undefined) throw new Error(failureMessage);
  return result;
}
