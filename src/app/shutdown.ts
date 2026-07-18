// SPDX-License-Identifier: AGPL-3.0-or-later
export type CloseOperation = () => void | Promise<void>;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function flattenCloseFailure(value: unknown): Error[] {
  if (value instanceof AggregateError) return value.errors.flatMap(flattenCloseFailure);
  return [toError(value)];
}

export async function settleClosePhases(
  phases: readonly (readonly CloseOperation[])[]
): Promise<Error[]> {
  const failures: Error[] = [];
  for (const phase of phases) {
    const results = await Promise.allSettled(
      phase.map((operation) => Promise.resolve().then(operation))
    );
    failures.push(
      ...results.flatMap((result) =>
        result.status === 'rejected' ? flattenCloseFailure(result.reason) : []
      )
    );
  }
  return failures;
}

export function createPhasedClose(
  phases: readonly (readonly CloseOperation[])[],
  recordedFailures: () => readonly Error[] = () => [],
  message = 'Owned cleanup failed'
): () => Promise<void> {
  let settlement: Promise<void> | undefined;
  return () => {
    settlement ??= (async () => {
      const operationFailures = await settleClosePhases(phases);
      const failures = [...recordedFailures().flatMap(flattenCloseFailure), ...operationFailures];
      if (failures.length > 0) throw new AggregateError(failures, message);
    })();
    return settlement;
  };
}
