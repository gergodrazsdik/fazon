// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../findings.js";
import type { SchemaName } from "../validation/schemas.js";
import { validateWithSchema, type SchemaFinding } from "../validation/validate.js";
import { parseYaml } from "../yaml.js";
import type { Config, ConfigFile, LocalConfigFile } from "./types.js";

export const configFileName = "fazon.yaml";
export const localConfigFileName = "fazon.local.yaml";

/** The framework's defaults (docs/spec/config.md#keys). `tokens`, `effort` and `prices` have none. */
export const configDefaults = {
  paths: {
    specs: "specs",
    components: "src/components",
    entry: "src/index.ts",
    tokens: "tokens/tokens.resolver.json",
    tokensCss: "src/tokens.css",
    conventions: "docs/conventions.md",
    baselines: "baselines",
  },
  icons: "lucide",
  loop: { iterations: 5, budgetUsd: 10, runMinutes: 90, callMinutes: 20, escalateAfter: 2 },
  models: { generator: "claude-sonnet-5-5", escalation: "claude-opus-5-5", judge: "claude-sonnet-5-5" },
  judge: { policy: "advisory", ciBudgetUsd: 3, repeats: 1, localPolicy: "on" },
} as const satisfies Omit<Config, "fazon" | "adapter" | "image" | "tokens" | "effort" | "prices">;

/** A config with its defaults applied, and which keys the local file set. */
export interface ResolvedConfig {
  readonly config: Config;
  /** The keys `fazon.local.yaml` set, such as `loop.budgetUsd`; a run record lists them. */
  readonly overrides: readonly string[];
}

/** Applies the defaults, then `fazon.yaml`, then `fazon.local.yaml`. */
export function resolveConfig(file: ConfigFile, local?: LocalConfigFile): ResolvedConfig {
  const config: Config = {
    fazon: 0,
    adapter: file.adapter,
    image: file.image,
    paths: { ...configDefaults.paths, ...file.paths },
    tokens: { ...file.tokens },
    icons: file.icons ?? configDefaults.icons,
    loop: { ...configDefaults.loop, ...file.loop, ...local?.loop },
    models: { ...configDefaults.models, ...file.models, ...local?.models },
    effort: { ...file.effort, ...local?.effort },
    judge: { ...configDefaults.judge, ...file.judge, ...local?.judge },
    prices: { ...file.prices },
  };
  const overrides =
    local === undefined
      ? []
      : (["loop", "models", "effort", "judge"] as const).flatMap((section) =>
          Object.keys(local[section] ?? {}).map((key) => `${section}.${key}`),
        );
  return { config, overrides };
}

export interface LoadConfigOptions {
  /** Whether this is CI (the `CI` variable is set), where a local file makes commands refuse. */
  readonly ci: boolean;
}

export type ConfigLoad =
  | ({ readonly ok: true } & ResolvedConfig)
  | {
      readonly ok: false;
      /** `fazon.yaml` doesn't exist. */
      readonly missing: boolean;
      /** This is CI, and `fazon.local.yaml` exists (CONFIG-004). */
      readonly localInCi: boolean;
      readonly findings: readonly Finding[];
    };

/**
 * Reads, validates and resolves the config of the repository at `root`
 * (CONFIG-001 and CONFIG-004 of docs/spec/config.md#validation).
 */
export async function loadConfig(root: string, options: LoadConfigOptions): Promise<ConfigLoad> {
  const main = await readYamlFile(root, configFileName, "config", "CONFIG-001");
  if (main === undefined) {
    return {
      ok: false,
      missing: true,
      localInCi: false,
      findings: [
        {
          rule: "CONFIG-001",
          file: configFileName,
          message: `${configFileName} doesn't exist in this directory`,
          hint: `Run fazon from the repository root, or set the repository up with 'fazon init'.`,
        },
      ],
    };
  }

  const local = await readYamlFile(root, localConfigFileName, "config-local", "CONFIG-004", explainLocalFinding);
  const findings = [...main.findings, ...(local?.findings ?? [])];
  const localInCi = local !== undefined && options.ci;
  if (localInCi) {
    findings.push({
      rule: "CONFIG-004",
      file: localConfigFileName,
      message: `${localConfigFileName} exists, and CI doesn't run with a developer's local overrides`,
      hint: `Remove ${localConfigFileName} from the CI checkout; it is never committed (fazon init adds it to .gitignore).`,
    });
  }
  if (findings.length > 0) {
    return { ok: false, missing: false, localInCi, findings };
  }
  return { ok: true, ...resolveConfig(main.data as ConfigFile, local?.data as LocalConfigFile | undefined) };
}

interface YamlFile {
  readonly data: unknown;
  readonly findings: readonly Finding[];
}

/** Reads a YAML file and checks it against a schema; `undefined` when it doesn't exist. */
async function readYamlFile(
  root: string,
  file: string,
  schema: SchemaName,
  rule: string,
  explain: (finding: SchemaFinding) => Pick<Finding, "message" | "hint"> = ({ message }) => ({ message }),
): Promise<YamlFile | undefined> {
  let text: string;
  try {
    text = await readFile(path.join(root, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const yaml = parseYaml(text);
  if (yaml.errors.length > 0) {
    return {
      data: undefined,
      findings: yaml.errors.map((error) => ({
        rule,
        file,
        ...(error.line === undefined ? {} : { line: error.line }),
        message: `${file} isn't valid YAML: ${error.message}`,
      })),
    };
  }
  const findings = validateWithSchema(schema, yaml.data).map((finding): Finding => {
    const line = yaml.lineOf(finding.segments, finding.key);
    return { rule, file, path: finding.path, ...(line === undefined ? {} : { line }), ...explain(finding) };
  });
  return { data: yaml.data, findings };
}

/** A key the local file may not hold gets a message that says what it may hold. */
function explainLocalFinding({ path, key, message }: SchemaFinding): Pick<Finding, "message" | "hint"> {
  if (key === undefined || !message.startsWith("unknown key")) {
    return { message };
  }
  const name = path === "$" ? key : `${path.slice(2)}.${key}`;
  return {
    message: `${localConfigFileName} can't set ${name}`,
    hint: `It may hold only fazon, loop, models, effort and judge.localPolicy; set ${name} in ${configFileName}.`,
  };
}
