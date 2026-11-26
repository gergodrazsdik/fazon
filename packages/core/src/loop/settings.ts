// SPDX-License-Identifier: GPL-3.0-or-later
// The loop's settings from the config (docs/spec/config.md#keys): the caps, the models and their
// effort, the escalation threshold and the judge's policy.
import type { Config, EffortLevel } from "../config/types.js";
import type { RunConfig } from "../records/run-record.js";

/** The run record's `config`, plus each role's effort, which the record stores per call. */
export interface LoopSettings extends RunConfig {
  readonly effort: { readonly generator?: EffortLevel; readonly escalation?: EffortLevel };
}

/**
 * The settings of an agent run from the resolved config. The local judge policy `off` makes the
 * run's judge policy `off`; otherwise it is the config's `judge.policy`.
 * @param judgeCalibrated whether the judge's calibration record meets the thresholds for its model
 */
export function loopSettings(config: Config, judgeCalibrated = false): LoopSettings {
  const { loop, models, effort } = config;
  return {
    caps: {
      iterations: loop.iterations,
      budgetUsd: loop.budgetUsd,
      runMinutes: loop.runMinutes,
      callMinutes: loop.callMinutes,
    },
    models: { generator: models.generator, escalation: models.escalation, judge: models.judge },
    escalateAfter: loop.escalateAfter,
    judgePolicy: config.judge.localPolicy === "off" ? "off" : config.judge.policy,
    judgeCalibrated,
    effort: {
      ...(effort.generator === undefined ? {} : { generator: effort.generator }),
      ...(effort.escalation === undefined ? {} : { escalation: effort.escalation }),
    },
  };
}

/** The run record's `config`: the settings without the effort. */
export function runConfig(settings: LoopSettings): RunConfig {
  return {
    caps: settings.caps,
    models: settings.models,
    escalateAfter: settings.escalateAfter,
    judgePolicy: settings.judgePolicy,
    ...(settings.judgeCalibrated === undefined ? {} : { judgeCalibrated: settings.judgeCalibrated }),
  };
}

/**
 * The model and effort of the next call (LOOP-003): the generator's until the run has had
 * `escalateAfter` failed iterations, the escalation model's from then on.
 */
export function modelFor(
  settings: LoopSettings,
  failedIterations: number,
): { readonly model: string; readonly effort?: EffortLevel; readonly escalated: boolean } {
  const escalated = failedIterations >= settings.escalateAfter;
  const role = escalated ? "escalation" : "generator";
  const effort = settings.effort[role];
  return { model: settings.models[role], ...(effort === undefined ? {} : { effort }), escalated };
}
