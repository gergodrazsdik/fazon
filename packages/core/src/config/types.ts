// SPDX-License-Identifier: GPL-3.0-or-later
// The config files as TypeScript types. docs/spec/schemas/config.schema.json and
// config-local.schema.json are the source of truth and docs/spec/config.md explains them; these
// types follow the schemas, and a change to a schema changes them in the same pull request.

export type AdapterId = "vue";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** The judge in CI. */
export type JudgePolicy = "advisory" | "blocking" | "off";

/** The judge in local runs: `off` skips it. */
export type LocalJudgePolicy = "on" | "off";

export type IconSet = "lucide" | { readonly path: string };

export interface Paths {
  readonly specs: string;
  readonly components: string;
  readonly entry: string;
  readonly tokens: string;
  readonly tokensCss: string;
  readonly conventions: string;
  readonly baselines: string;
}

export interface Loop {
  /** Agent calls per run. */
  readonly iterations: number;
  readonly budgetUsd: number;
  readonly runMinutes: number;
  readonly callMinutes: number;
  /** Failed iterations before the escalation model. */
  readonly escalateAfter: number;
}

export interface Models {
  readonly generator: string;
  readonly escalation: string;
  readonly judge: string;
}

/** Effort per role; a role left out runs at its model's default. */
export interface Effort {
  readonly generator?: EffortLevel;
  readonly escalation?: EffortLevel;
  readonly judge?: EffortLevel;
}

/** USD per million tokens. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/** `fazon.yaml` as written: every key but `fazon`, `adapter` and `image` may be left out. */
export interface ConfigFile {
  readonly fazon: 0;
  readonly adapter: AdapterId;
  /** The verifier image, by digest. */
  readonly image: string;
  readonly paths?: Partial<Paths>;
  readonly tokens?: { readonly prefix?: string };
  readonly icons?: IconSet;
  readonly loop?: Partial<Loop>;
  readonly models?: Partial<Models>;
  readonly effort?: Effort;
  readonly judge?: {
    readonly policy?: JudgePolicy;
    readonly ciBudgetUsd?: number;
    readonly repeats?: number;
  };
  readonly prices?: Readonly<Record<string, ModelPrice>>;
}

/** `fazon.local.yaml`: a developer's overrides of the loop, the models, the effort and the local judge. */
export interface LocalConfigFile {
  readonly fazon: 0;
  readonly loop?: Partial<Loop>;
  readonly models?: Partial<Models>;
  readonly effort?: Effort;
  readonly judge?: { readonly localPolicy?: LocalJudgePolicy };
}

/** The config every command works with: the defaults, then `fazon.yaml`, then `fazon.local.yaml`. */
export interface Config {
  readonly fazon: 0;
  readonly adapter: AdapterId;
  readonly image: string;
  readonly paths: Paths;
  readonly tokens: {
    /** The custom properties' prefix; none by default. */
    readonly prefix?: string;
  };
  readonly icons: IconSet;
  readonly loop: Loop;
  readonly models: Models;
  readonly effort: Effort;
  readonly judge: {
    readonly policy: JudgePolicy;
    readonly ciBudgetUsd: number;
    readonly repeats: number;
    readonly localPolicy: LocalJudgePolicy;
  };
  /** Prices from the config, by model; the framework's price table fills in the rest. */
  readonly prices: Readonly<Record<string, ModelPrice>>;
}
