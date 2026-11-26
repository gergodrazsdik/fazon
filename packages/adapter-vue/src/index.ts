// SPDX-License-Identifier: GPL-3.0-or-later
import type { Adapter } from "@fazon/core";
import { adapterId, mapComponent, mapValueSchema } from "./api.js";
import { selfChecks, sourceCommands, testRule } from "./commands.js";
import { themesFile } from "./config-files.js";
import { entryFileText, generateFiles } from "./generate.js";

/** The Vue 3 adapter (docs/spec/adapter-boundary.md#the-vue-adapter). */
export const vueAdapter: Adapter = {
  id: adapterId,
  framework: "Vue 3",
  extensionSchema: { map: mapValueSchema },
  componentFiles(spec) {
    return {
      files: mapComponent(spec, "").scopes.map((scope) => ({
        name: scope.name,
        ...(scope.part === undefined ? {} : { part: scope.part }),
        exportName: scope.exportName,
        file: scope.file,
      })),
      patterns: ["*.vue", "*.ts", "*.css"],
    };
  },
  generate: generateFiles,
  entryFile: entryFileText,
  themesFile,
  sourceCommands,
  selfChecks,
  testRule,
};

export { selfChecks, sourceCommands, testRule } from "./commands.js";
export {
  apiFile,
  mapComponent,
  typeExpression,
  vueComponentName,
  type VueApiFile,
  type VueComponentApi,
  type VueEvent,
  type VueExposed,
  type VueProp,
  type VueSlot,
  type VueType,
} from "./api.js";
export { apiFileName, entryFileText, formatTypeScript, generateFiles } from "./generate.js";
export { storyFileName } from "./stories.js";
export {
  configFiles,
  storybookDirectory,
  themesFile,
  themesFilePath,
  type ConfigFile,
  type ConfigFilesInput,
} from "./config-files.js";
export { lintConfigFiles } from "./lint/config-files.js";
