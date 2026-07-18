// SPDX-License-Identifier: AGPL-3.0-or-later
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export const PROMPT_NAMES = [
  'diagnose_network_problem',
  'publish_internal_service',
  'block_domain_for_device'
] as const;

const DiagnosisArgsSchema = z.object({
  symptom: z.string().min(1).max(500),
  device: z.string().min(1).max(200).optional()
});

const PublicationArgsSchema = z.object({
  serviceUrl: z.url(),
  desiredName: z.string().min(1).max(253).optional(),
  audience: z.enum(['single-device', 'local-network', 'vpn-users']).optional()
});

const DomainBlockArgsSchema = z.object({
  domain: z
    .string()
    .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i),
  device: z.string().min(1).max(200).optional()
});

type DiagnosisArgs = z.infer<typeof DiagnosisArgsSchema>;
type PublicationArgs = z.infer<typeof PublicationArgsSchema>;
type DomainBlockArgs = z.infer<typeof DomainBlockArgsSchema>;

export function renderNetworkDiagnosisPrompt(args: DiagnosisArgs): string {
  return [
    `Investigate this symptom using read-only checks only: ${JSON.stringify(args.symptom)}.`,
    args.device
      ? `The user identifies the affected device as ${JSON.stringify(args.device)}.`
      : 'Ask one simple question to identify the affected device if that changes the diagnosis.',
    'Explain each verified observation in plain language, list each hypothesis separately, and propose the smallest next check. Do not change configuration.'
  ].join(' ');
}

export function renderInternalPublicationPrompt(args: PublicationArgs): string {
  return [
    `Prepare an internal-only publication plan for ${JSON.stringify(args.serviceUrl)}.`,
    args.desiredName
      ? `The requested internal name is ${JSON.stringify(args.desiredName)}.`
      : 'Ask for the desired internal DNS name.',
    args.audience
      ? `The intended audience is ${args.audience}.`
      : 'Ask whether the service is for one device, the local network, or VPN users.',
    'Explain internal DNS, certificate, HAProxy, verification, backup, and recovery in plain language. Do not change the firewall; return a preparation plan only.'
  ].join(' ');
}

export function renderDeviceDomainBlockPrompt(args: DomainBlockArgs): string {
  return [
    `Prepare a device-scoped DNS block for ${JSON.stringify(args.domain)}.`,
    args.device
      ? `The named device is ${JSON.stringify(args.device)}; verify its stable identity before proposing a rule.`
      : 'Ask which device should be affected and how it can be identified safely.',
    'Explain DNS-level limitations and verification in plain language. Never replace this with a global block. Do not change configuration; return a preparation plan only.'
  ].join(' ');
}

export function registerPedagogicalPrompts(server: McpServer): void {
  server.registerPrompt(
    'diagnose_network_problem',
    {
      title: 'Diagnose a network problem',
      description: 'Investigate a user-described network problem using read-only evidence.',
      argsSchema: DiagnosisArgsSchema
    },
    (args) => ({
      messages: [
        { role: 'user', content: { type: 'text', text: renderNetworkDiagnosisPrompt(args) } }
      ]
    })
  );

  server.registerPrompt(
    'publish_internal_service',
    {
      title: 'Plan an internal service publication',
      description: 'Clarify and prepare an internal DNS, certificate, and HAProxy publication.',
      argsSchema: PublicationArgsSchema
    },
    (args) => ({
      messages: [
        { role: 'user', content: { type: 'text', text: renderInternalPublicationPrompt(args) } }
      ]
    })
  );

  server.registerPrompt(
    'block_domain_for_device',
    {
      title: 'Plan a device-scoped domain block',
      description: 'Clarify and prepare a DNS block that affects one identified device.',
      argsSchema: DomainBlockArgsSchema
    },
    (args) => ({
      messages: [
        { role: 'user', content: { type: 'text', text: renderDeviceDomainBlockPrompt(args) } }
      ]
    })
  );
}
