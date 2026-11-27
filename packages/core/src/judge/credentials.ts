// SPDX-License-Identifier: GPL-3.0-or-later
// The judge's credential (docs/spec/cli.md#environment, ADR 0027): an API key, or the workload
// identity federation variables. The client is built from exactly that one, so no other source
// the SDK knows, such as a profile, is ever used. Nothing here prints or stores a credential
// (CLI-003).
import Anthropic from "@anthropic-ai/sdk";

export type JudgeCredential =
  | { readonly kind: "api-key"; readonly apiKey: string }
  | {
      readonly kind: "federation";
      readonly federationRuleId: string;
      readonly organizationId: string;
      readonly serviceAccountId: string;
      readonly identityTokenFile: string;
      readonly workspaceId?: string;
    };

/** The federation variables; the workspace is needed only when the rule covers more than one. */
export const federationVariables = [
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_SERVICE_ACCOUNT_ID",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
] as const;

function value(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const text = env[name];
  return text === undefined || text.trim() === "" ? undefined : text;
}

/** The credential the environment gives the judge: an API key first, then federation; undefined without either. */
export function judgeCredential(env: Readonly<Record<string, string | undefined>>): JudgeCredential | undefined {
  const apiKey = value(env, "ANTHROPIC_API_KEY");
  if (apiKey !== undefined) return { kind: "api-key", apiKey };
  const [rule, organization, account, file] = federationVariables.map((name) => value(env, name));
  if (rule === undefined || organization === undefined || account === undefined || file === undefined) return undefined;
  const workspaceId = value(env, "ANTHROPIC_WORKSPACE_ID");
  return {
    kind: "federation",
    federationRuleId: rule,
    organizationId: organization,
    serviceAccountId: account,
    identityTokenFile: file,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

/** What the judge's missing credential means, for a refusal or `doctor`. */
export const missingCredential =
  "the judge needs ANTHROPIC_API_KEY, or the workload identity federation variables (" +
  `${federationVariables.join(", ")})`;

/**
 * The SDK client for a credential. Federation exchanges the identity token in the file for a
 * short-lived API token, reading the file again at each exchange and caching the token in memory
 * only.
 */
export function judgeSdkClient(credential: JudgeCredential, options: { readonly maxRetries?: number } = {}): Anthropic {
  const common = { maxRetries: options.maxRetries ?? 3 };
  if (credential.kind === "api-key") return new Anthropic({ ...common, apiKey: credential.apiKey });
  return new Anthropic({
    ...common,
    config: {
      authentication: {
        type: "oidc_federation",
        federation_rule_id: credential.federationRuleId,
        service_account_id: credential.serviceAccountId,
        identity_token: { source: "file", path: credential.identityTokenFile },
      },
      organization_id: credential.organizationId,
      ...(credential.workspaceId === undefined ? {} : { workspace_id: credential.workspaceId }),
    },
  });
}
