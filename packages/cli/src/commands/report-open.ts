// SPDX-License-Identifier: GPL-3.0-or-later
// Opens the report in the browser with the platform's opener. A missing opener, or one that fails,
// is never an error: `fazon report` prints the report's path either way.
import { isSet, type Environment } from "../environment.js";

/** A program that opens a file in the default browser, and its arguments. */
export interface Opener {
  readonly program: string;
  readonly args: readonly string[];
}

/** How long an opener may take before it counts as failed. */
const openerTimeoutMs = 10_000;

/** Whether the CLI runs in WSL, where Windows' browser opens files through wslview or wsl-open. */
function isWsl(environment: Environment): boolean {
  return isSet(environment, "WSL_DISTRO_NAME") || isSet(environment, "WSL_INTEROP");
}

/**
 * The openers to try for a file, in order: `open` on macOS; on Windows, the shell's handler for the
 * file through `rundll32`; in WSL, `wslview` and `wsl-open`, then `xdg-open`; elsewhere `xdg-open`.
 */
export function openers(file: string, environment: Environment, platform: string): Opener[] {
  switch (platform) {
    case "darwin":
      return [{ program: "open", args: [file] }];
    case "win32":
      return [{ program: "rundll32", args: ["url.dll,FileProtocolHandler", file] }];
    default:
      return [
        ...(isWsl(environment)
          ? [
              { program: "wslview", args: [file] },
              { program: "wsl-open", args: [file] },
            ]
          : []),
        { program: "xdg-open", args: [file] },
      ];
  }
}

/** Opens a file in the browser: the opener that did, or undefined when none is installed or each failed. */
export async function openInBrowser(
  file: string,
  environment: Environment,
  platform: string = process.platform,
): Promise<string | undefined> {
  for (const opener of openers(file, environment, platform)) {
    const result = await environment.exec(opener.program, opener.args, { timeoutMs: openerTimeoutMs });
    if (result?.exitCode === 0) return opener.program;
  }
  return undefined;
}
