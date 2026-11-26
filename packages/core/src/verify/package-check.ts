// SPDX-License-Identifier: GPL-3.0-or-later
// The `package` check on the packed tarball (docs/spec/check-catalogue.md#package): publint
// (`manifest`), Are the Types Wrong (`types`), the stylesheet (`styles`), and every component and
// part exported from the package entry when it's imported from the tarball (`export`).
import { checkPackage as attwCheck, createPackageFromTarballData } from "@arethetypeswrong/core";
import { problemAffectsResolutionKind, problemKindInfo } from "@arethetypeswrong/core/problems";
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import type { TypesResolution } from "../adapter.js";
import type { CheckFinding } from "../checks/types.js";

/** A component's exports, as the adapter names them, and the file a finding about it names. */
export interface PackageComponent {
  /** The component's root file, relative to the repository root. */
  readonly file: string;
  /** The names the package entry must export: the component's and each part's. */
  readonly exports: readonly string[];
}

/** What the import of the package entry from the tarball gave. */
export type EntryImport =
  { readonly ok: true; readonly names: readonly string[] } | { readonly ok: false; readonly error: string };

/** The packed package: its tarball's bytes, its manifest and its file list. */
export interface PackedPackage {
  readonly tarball: Uint8Array;
  readonly manifest: Readonly<Record<string, unknown>>;
  /** The files in the tarball, relative to the package root. */
  readonly files: readonly string[];
  /** The text of the JavaScript files the root export resolves to, for the stylesheet import. */
  readonly entryText?: string;
}

/** The packed package with its files' text, by path relative to the package root. */
export interface UnpackedPackage extends PackedPackage {
  readonly name: string;
  readonly text: (file: string) => string;
}

/** Reads a tarball as `npm pack` writes it: its manifest, files and the root export's JavaScript. */
export function readPackedPackage(tarball: Uint8Array): UnpackedPackage {
  const pkg = createPackageFromTarballData(tarball);
  const prefix = `/node_modules/${pkg.packageName}/`;
  const files = pkg
    .listFiles()
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    .sort();
  const text = (file: string) => pkg.readFile(`${prefix}${file}`);
  const manifest = JSON.parse(text("package.json")) as Record<string, unknown>;
  const entry = rootExport(manifest);
  const entryFile = entry?.replace(/^\.\//, "");
  return {
    name: pkg.packageName,
    tarball,
    manifest,
    files,
    text,
    ...(entryFile !== undefined && files.includes(entryFile) ? { entryText: text(entryFile) } : {}),
  };
}

/** The JavaScript file `import "<package>"` resolves to by the manifest: `exports["."]`, or `module`/`main`. */
function rootExport(manifest: Readonly<Record<string, unknown>>): string | undefined {
  const exports = manifest.exports;
  const pick = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const conditions = value as Record<string, unknown>;
      for (const key of ["import", "module", "default", "node"]) {
        const found = pick(conditions[key]);
        if (found !== undefined && !found.endsWith(".d.ts")) return found;
      }
    }
    return undefined;
  };
  if (typeof exports === "string") return exports;
  if (exports !== null && typeof exports === "object") {
    const map = exports as Record<string, unknown>;
    return Object.keys(map).some((key) => key.startsWith(".")) ? pick(map["."]) : pick(map);
  }
  for (const field of ["module", "main"]) if (typeof manifest[field] === "string") return manifest[field];
  return undefined;
}

const finding = (rule: string, message: string, extra: Partial<CheckFinding> = {}): CheckFinding => ({
  check: "package",
  rule,
  message,
  ...extra,
  blocking: true,
});

/** `manifest`: publint's errors and warnings; its suggestions aren't findings. */
export async function manifestFindings(pkg: PackedPackage): Promise<CheckFinding[]> {
  const buffer = pkg.tarball.buffer.slice(pkg.tarball.byteOffset, pkg.tarball.byteOffset + pkg.tarball.byteLength);
  const { messages, pkg: manifest } = await publint({ level: "warning", pack: { tarball: buffer as ArrayBuffer } });
  return messages.map((message) =>
    finding(
      "manifest",
      `publint ${message.code}: ${formatMessage(message, manifest, { color: false }) ?? message.code}`,
      {
        file: "package.json",
      },
    ),
  );
}

/**
 * `types`: Are the Types Wrong's problems for the package's entrypoints, other than its
 * stylesheets, in the module resolutions the adapter names (bundler resolution for Vue, which reads
 * the `.vue` files' declarations).
 */
export async function typesFindings(
  pkg: PackedPackage,
  resolutions: readonly TypesResolution[] = ["bundler"],
): Promise<CheckFinding[]> {
  const result = await attwCheck(createPackageFromTarballData(pkg.tarball));
  if (result.types === false) {
    return [finding("types", "The package has no type declarations: its exports need them.", { file: "package.json" })];
  }
  const findings: CheckFinding[] = [];
  const seen = new Set<string>();
  for (const problem of result.problems) {
    const entrypoint = "entrypoint" in problem ? problem.entrypoint : undefined;
    const resolution = "resolutionKind" in problem ? problem.resolutionKind : undefined;
    if (!resolutions.some((kind) => problemAffectsResolutionKind(problem, kind, result))) continue;
    if (entrypoint !== undefined && /\.css$|package\.json$/.test(entrypoint)) continue;
    const info = problemKindInfo[problem.kind];
    const where =
      entrypoint === undefined ? "" : ` (${entrypoint}${resolution === undefined ? "" : `, ${resolution}`})`;
    const message = `Are the Types Wrong ${problem.kind}${where}: ${info.description}`;
    if (seen.has(message)) continue;
    seen.add(message);
    findings.push(finding("types", message, { file: "package.json" }));
  }
  return findings;
}

/** Every string value in an `exports` map, with nested conditions. */
function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}

/** `styles`: the package ships a stylesheet, and its exports map, `style` field or entry reaches it. */
export function stylesFindings(pkg: PackedPackage): CheckFinding[] {
  const sheets = pkg.files.filter((file) => file.endsWith(".css"));
  if (sheets.length === 0) {
    return [
      finding("styles", "The packed package has no stylesheet: the components' styles aren't in it.", {
        file: "package.json",
      }),
    ];
  }
  const targets = [...exportTargets(pkg.manifest.exports), ...exportTargets(pkg.manifest.style)].map((t) =>
    t.replace(/^\.\//, ""),
  );
  const reached = sheets.some(
    (sheet) =>
      targets.includes(sheet) ||
      targets.some((t) => t.includes("*") && sheet.endsWith(".css") && t.endsWith(".css")) ||
      (pkg.entryText?.includes(sheet.split("/").at(-1) ?? sheet) ?? false),
  );
  return reached
    ? []
    : [
        finding(
          "styles",
          `The package's stylesheet (${sheets.join(", ")}) is neither in its exports map nor imported by its entry, so importing a component doesn't load its styles.`,
          { file: "package.json" },
        ),
      ];
}

/** `export`: every component and part is exported from the package entry, imported from the tarball. */
export function exportFindings(entry: EntryImport, components: readonly PackageComponent[]): CheckFinding[] {
  if (!entry.ok) {
    return [
      finding("export", `The package entry doesn't import from the packed tarball: ${entry.error}`, {
        file: "package.json",
      }),
    ];
  }
  const names = new Set(entry.names);
  return components.flatMap((component) =>
    component.exports
      .filter((name) => !names.has(name))
      .map((name) =>
        finding("export", `${name} isn't exported from the package entry of the packed tarball.`, {
          file: component.file,
          expected: name,
        }),
      ),
  );
}
