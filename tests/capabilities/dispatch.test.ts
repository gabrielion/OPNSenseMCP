// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import {
  CapabilityCatalog,
  createProductCapabilityCatalog
} from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import type {
  CapabilityRequest,
  MutationEnvelopeServices,
  RefusalCode,
  ServerContext,
  TransportKind
} from '../../src/capabilities/types.js';
import type { FeatureFlag } from '../../src/config/feature-flags.js';
import { loadRuntimeConfig, type RuntimeConfig } from '../../src/config/runtime-config.js';
import { formatCapabilityResult, refusalResult } from '../../src/mcp/results.js';
import type { OPNsenseAliasAdapter } from '../../src/opnsense/alias-adapter.js';
import type { OPNsenseReadAdapter } from '../../src/opnsense/read-adapter.js';
import { createReadFixture } from '../fixtures/capabilities.js';

type PolicyConfigOverrides = Partial<
  Pick<RuntimeConfig, 'readOnly' | 'allowedResourceScopes' | 'enabledFeatureFlags'>
>;

function config(overrides: PolicyConfigOverrides = {}): RuntimeConfig {
  return {
    readOnly: false,
    allowedResourceScopes: null,
    enabledFeatureFlags: new Set(),
    ...overrides,
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: false,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['localhost'],
      allowedOrigins: [],
      legacySseEnabled: false
    }
  };
}

function context(
  application: ReturnType<typeof createApplicationContext>,
  transport: TransportKind = 'stdio'
): ServerContext {
  return { application, transport };
}

const PRODUCT_CREATE_REQUEST: CapabilityRequest = {
  name: 'opn_create',
  arguments: {
    resource: 'firewall.alias',
    attributes: {
      name: 'policy_matrix',
      type: 'host',
      content: ['192.0.2.10'],
      description: 'policy matrix'
    }
  }
};
const PRODUCT_DELETE_REQUEST: CapabilityRequest = {
  name: 'opn_delete',
  arguments: {
    resource: 'firewall.alias',
    id: '00000000-0000-0000-0000-000000000001'
  }
};
const PRODUCT_WRITE_REQUESTS: readonly CapabilityRequest[] = [
  PRODUCT_CREATE_REQUEST,
  PRODUCT_DELETE_REQUEST
];

interface ProductWritePolicyCase {
  readonly label: string;
  readonly transport: TransportKind | 'unsupported';
  readonly readOnly: boolean;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly expectedCode: RefusalCode | null;
}

const exactWriteFlag = new Set<FeatureFlag>(['experimental-alias-write']);
const exactAliasScope = new Set(['firewall.alias']);
const PRODUCT_WRITE_POLICY_MATRIX = [
  {
    label: 'READ_ONLY before an unsupported transport',
    transport: 'unsupported',
    readOnly: true,
    enabledFeatureFlags: new Set<FeatureFlag>(),
    allowedResourceScopes: null,
    expectedCode: 'READ_ONLY'
  },
  {
    label: 'READ_ONLY',
    transport: 'stdio',
    readOnly: true,
    enabledFeatureFlags: new Set<FeatureFlag>(),
    allowedResourceScopes: null,
    expectedCode: 'READ_ONLY'
  },
  {
    label: 'missing feature flag',
    transport: 'stdio',
    readOnly: false,
    enabledFeatureFlags: new Set<FeatureFlag>(),
    allowedResourceScopes: null,
    expectedCode: 'FEATURE_DISABLED'
  },
  {
    label: 'missing feature flag before an unsupported transport',
    transport: 'unsupported',
    readOnly: false,
    enabledFeatureFlags: new Set<FeatureFlag>(),
    allowedResourceScopes: null,
    expectedCode: 'FEATURE_DISABLED'
  },
  {
    label: 'absent scope allow-list',
    transport: 'stdio',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: null,
    expectedCode: 'RESOURCE_NOT_ALLOWED'
  },
  {
    label: 'empty scope allow-list',
    transport: 'stdio',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: new Set<string>(),
    expectedCode: 'RESOURCE_NOT_ALLOWED'
  },
  {
    label: 'wrong scope allow-list',
    transport: 'stdio',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: new Set(['system.status']),
    expectedCode: 'RESOURCE_NOT_ALLOWED'
  },
  {
    label: 'wrong scope allow-list before an unsupported transport',
    transport: 'unsupported',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: new Set(['system.status']),
    expectedCode: 'RESOURCE_NOT_ALLOWED'
  },
  {
    label: 'unsupported transport after eligible policy',
    transport: 'unsupported',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: exactAliasScope,
    expectedCode: 'UNSUPPORTED_TRANSPORT'
  },
  {
    label: 'eligible stdio policy',
    transport: 'stdio',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: exactAliasScope,
    expectedCode: null
  },
  {
    label: 'eligible HTTP policy',
    transport: 'http',
    readOnly: false,
    enabledFeatureFlags: exactWriteFlag,
    allowedResourceScopes: exactAliasScope,
    expectedCode: null
  }
] as const satisfies readonly ProductWritePolicyCase[];

function createProductWriteHarness(runtimeConfig: RuntimeConfig) {
  const readAdapter = {
    available: true,
    getSystemStatus: vi.fn(() => Promise.reject(new Error('read handler must not run'))),
    listServices: vi.fn(() => Promise.reject(new Error('read handler must not run')))
  } satisfies OPNsenseReadAdapter;
  const aliasAdapter = {
    available: true,
    searchHostAliases: vi.fn(() => Promise.reject(new Error('alias preflight must not run'))),
    createHostAlias: vi.fn(() => Promise.reject(new Error('create handler must not run'))),
    deleteHostAlias: vi.fn(() => Promise.reject(new Error('delete handler must not run')))
  } satisfies OPNsenseAliasAdapter;
  const mutationServices = {
    lock: {
      acquire: vi.fn(() => Promise.reject(new Error('mutation lock must not run')))
    },
    backup: {
      create: vi.fn(() => Promise.reject(new Error('backup must not run'))),
      exists: vi.fn(() => Promise.reject(new Error('backup verification must not run')))
    },
    audit: {
      record: vi.fn()
    }
  } satisfies MutationEnvelopeServices;
  const application = createApplicationContext(
    runtimeConfig,
    createProductCapabilityCatalog(readAdapter, aliasAdapter),
    mutationServices
  );
  return {
    application,
    mutationSpies: [
      aliasAdapter.searchHostAliases,
      aliasAdapter.createHostAlias,
      aliasAdapter.deleteHostAlias,
      mutationServices.lock.acquire,
      mutationServices.backup.create,
      mutationServices.backup.exists,
      mutationServices.audit.record
    ] as const
  };
}

function createUnavailableProductWriteHarness(runtimeConfig: RuntimeConfig) {
  const readAdapter = {
    available: false,
    getSystemStatus: vi.fn(() => Promise.reject(new Error('read handler must not run'))),
    listServices: vi.fn(() => Promise.reject(new Error('read handler must not run')))
  } satisfies OPNsenseReadAdapter;
  const aliasAdapter = {
    available: false,
    searchHostAliases: vi.fn(() => Promise.reject(new Error('alias preflight must not run'))),
    createHostAlias: vi.fn(() => Promise.reject(new Error('create handler must not run'))),
    deleteHostAlias: vi.fn(() => Promise.reject(new Error('delete handler must not run')))
  } satisfies OPNsenseAliasAdapter;
  const application = createApplicationContext(
    runtimeConfig,
    createProductCapabilityCatalog(readAdapter, aliasAdapter)
  );
  return {
    application,
    adapterSpies: [
      readAdapter.getSystemStatus,
      readAdapter.listServices,
      aliasAdapter.searchHostAliases,
      aliasAdapter.createHostAlias,
      aliasAdapter.deleteHostAlias
    ] as const
  };
}

describe('opaque application dispatch', () => {
  it('routes valid and forged cached names through the closed kernel', async () => {
    const handler = vi.fn(({ value }: { value: string }) => Promise.resolve({ echoed: value }));
    const fixture = createReadFixture({ handler });
    const application = createApplicationContext(config(), new CapabilityCatalog([fixture]));

    await expect(
      dispatchCapability(
        { name: fixture.mcpName, arguments: { value: 'safe' } },
        context(application)
      )
    ).resolves.toEqual({ kind: 'success', output: { echoed: 'safe' } });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(
      dispatchCapability(
        { name: 'stale_cached_name', arguments: { value: 'unsafe' } },
        context(application)
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'UNKNOWN_CAPABILITY' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reveals exactly catalog and rejects spread, clone, and constructed lookalikes', () => {
    const application = createApplicationContext(config());
    expect(Object.getOwnPropertyNames(application)).toEqual(['catalog']);
    expect(Object.getOwnPropertySymbols(application)).toEqual([]);
    expect({ ...application }).toEqual({ catalog: application.catalog });
    expect(Object.keys(JSON.parse(JSON.stringify(application)) as object)).toEqual(['catalog']);
    expect(Reflect.get(application, 'dispatcher')).toBeUndefined();
    expect(Reflect.get(application, 'settlement')).toBeUndefined();

    for (const forged of [
      { catalog: application.catalog },
      { ...application },
      Object.assign({}, application)
    ]) {
      expect(() =>
        dispatchCapability({ name: 'server_status', arguments: {} }, {
          application: forged,
          transport: 'stdio'
        } as ServerContext)
      ).toThrow(/^Application context is not initialized$/);
    }
  });

  it('keeps the sole facade free of duplicate policy conditions', async () => {
    const source = await readFile('src/capabilities/dispatch.ts', 'utf8');
    for (const forbidden of [
      'readOnly',
      'allowedResource',
      'enabledFeature',
      '.policy',
      '.catalog'
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('formats every refusal code without reflecting raw messages, exceptions, or secrets', () => {
    const codes: RefusalCode[] = [
      'CANCELLED',
      'CONFIRMATION_DECLINED',
      'CONFIRMATION_INVALID',
      'CONFIRMATION_UNAVAILABLE',
      'EXECUTION_FAILED',
      'FEATURE_DISABLED',
      'INVALID_INPUT',
      'INVALID_OUTPUT',
      'INVALID_POLICY',
      'INVALID_RESOURCE_INPUT',
      'OPERATION_NOT_AVAILABLE',
      'OUTCOME_INDETERMINATE',
      'READ_ONLY',
      'RESOURCE_NOT_ALLOWED',
      'TIMEOUT',
      'TARGET_UNAVAILABLE',
      'UNKNOWN_CAPABILITY',
      'UNKNOWN_RESOURCE',
      'UNSUPPORTED_TRANSPORT'
    ];
    for (const code of codes) {
      const direct = refusalResult(code);
      const formatted = formatCapabilityResult({
        kind: 'refused',
        code,
        message: 'SENTINEL_SECRET raw Zod issue stack requestState HMAC_KEY'
      });
      expect(formatted).toEqual(direct);
      expect(formatted.structuredContent).toEqual({ code });
      expect(JSON.stringify(formatted)).not.toMatch(
        /SENTINEL_SECRET|Zod|stack|requestState|HMAC_KEY/u
      );
    }
  });
});

describe('P0-B product write dispatch policy', () => {
  it.each(PRODUCT_WRITE_POLICY_MATRIX)(
    '$label applies before either product write handler',
    async (testCase) => {
      const { application, mutationSpies } = createProductWriteHarness(
        config({
          readOnly: testCase.readOnly,
          enabledFeatureFlags: testCase.enabledFeatureFlags,
          allowedResourceScopes: testCase.allowedResourceScopes
        })
      );

      for (const request of PRODUCT_WRITE_REQUESTS) {
        const result = await dispatchCapability(
          request,
          context(application, testCase.transport as TransportKind)
        );
        if (testCase.expectedCode === null) {
          expect(result).toMatchObject({
            kind: 'confirmation-required',
            challenge: {
              capabilityId: request.name === 'opn_create' ? 'opnsense.create' : 'opnsense.delete'
            }
          });
        } else {
          expect(result).toMatchObject({ kind: 'refused', code: testCase.expectedCode });
        }
      }

      for (const spy of mutationSpies) expect(spy).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      label: 'absent',
      environment: {
        READ_ONLY: 'false',
        ENABLED_FEATURE_FLAGS: 'experimental-alias-write'
      }
    },
    {
      label: 'an empty string',
      environment: {
        READ_ONLY: 'false',
        ENABLED_FEATURE_FLAGS: 'experimental-alias-write',
        ALLOWED_RESOURCES: ''
      }
    }
  ])(
    'normalizes an $label ALLOWED_RESOURCES input and refuses opn_create before its handler',
    async ({ environment }) => {
      const runtimeConfig = loadRuntimeConfig(environment);
      expect(runtimeConfig.allowedResourceScopes).toBeNull();
      const { application, mutationSpies } = createProductWriteHarness(runtimeConfig);

      await expect(
        dispatchCapability(PRODUCT_CREATE_REQUEST, context(application))
      ).resolves.toMatchObject({ kind: 'refused', code: 'RESOURCE_NOT_ALLOWED' });
      for (const spy of mutationSpies) expect(spy).not.toHaveBeenCalled();
    }
  );
});

describe('P0-B unavailable product write dispatch policy', () => {
  it.each(PRODUCT_WRITE_POLICY_MATRIX)(
    '$label applies before target availability for both product writes',
    async (testCase) => {
      const { application, adapterSpies } = createUnavailableProductWriteHarness(
        config({
          readOnly: testCase.readOnly,
          enabledFeatureFlags: testCase.enabledFeatureFlags,
          allowedResourceScopes: testCase.allowedResourceScopes
        })
      );

      expect(application.catalog.all.map(({ mcpName }) => mcpName)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list'
      ]);

      for (const request of PRODUCT_WRITE_REQUESTS) {
        await expect(
          dispatchCapability(request, context(application, testCase.transport as TransportKind))
        ).resolves.toMatchObject({
          kind: 'refused',
          code: testCase.expectedCode ?? 'TARGET_UNAVAILABLE'
        });
      }
      for (const spy of adapterSpies) expect(spy).not.toHaveBeenCalled();
    }
  );

  it('keeps a genuinely unknown forged product name unknown without a target', async () => {
    const application = createApplicationContext(
      config({
        readOnly: false,
        enabledFeatureFlags: exactWriteFlag,
        allowedResourceScopes: exactAliasScope
      }),
      createProductCapabilityCatalog()
    );

    await expect(
      dispatchCapability({ name: 'opn_wipe', arguments: {} }, context(application))
    ).resolves.toMatchObject({ kind: 'refused', code: 'UNKNOWN_CAPABILITY' });
  });
});
