// SPDX-License-Identifier: GPL-3.0-or-later
// The rendered checks' fixtures, rendered in the verifier image's Chromium (`just test-rendered`):
// every page in docs/spec/examples/checks/ and in __fixtures__/ runs through its own check and must
// give exactly the result its `fazon-fixture` comment names: no finding of the check for
// `expect=pass`, and only findings of the named rule otherwise.
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ariaObservations,
  checkAxe,
  checkLayout,
  checkSpecA11y,
  checkSpecAria,
  checkTokens,
  checkVisualStory,
  decodePng,
  launchRenderer,
  renderDefaults,
  tokenRuleExpectations,
  type A11ySpec,
  type CheckFinding,
  type PropValues,
  type Renderer,
  type TokenIndex,
  type TokenRule,
} from "../index.js";
import { fixtureTokenIndex } from "./test-support.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const examples = join(repo, "docs/spec/examples/checks");
const own = fileURLToPath(new URL("__fixtures__/", import.meta.url));

interface Fixture {
  readonly file: string;
  readonly name: string;
  readonly check: string;
  readonly expect: string;
  readonly spec?: A11ySpec;
  readonly props?: Readonly<Record<string, readonly PropValues[]>>;
  readonly tokenRules?: readonly TokenRule[];
}

async function fixturesIn(dir: string): Promise<Fixture[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const fixtures: Fixture[] = [];
  for (const entry of entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    const marker = /<!-- fazon-fixture: check=([a-z0-9]+) expect=([a-z0-9-]+) -->/.exec(text);
    if (marker === null) throw new Error(`${file} has no fazon-fixture comment.`);
    const json = (key: string): unknown => {
      const match = new RegExp(`<!-- ${key}: (.*) -->`).exec(text);
      return match === null ? undefined : JSON.parse(match[1] ?? "");
    };
    const spec = json("fazon-spec") as A11ySpec | undefined;
    const props = json("fazon-props") as Record<string, PropValues[]> | undefined;
    const tokenRules = json("fazon-token-rules") as TokenRule[] | undefined;
    fixtures.push({
      file,
      name: `${basename(dirname(file))}/${entry.name}`,
      check: marker[1] ?? "",
      expect: marker[2] ?? "",
      ...(spec === undefined ? {} : { spec }),
      ...(props === undefined ? {} : { props }),
      ...(tokenRules === undefined ? {} : { tokenRules }),
    });
  }
  return fixtures;
}

const fixtures = [...(await fixturesIn(examples)), ...(await fixturesIn(own))];
let renderer: Renderer;
let index: TokenIndex;
let baseline: Uint8Array;

beforeAll(async () => {
  renderer = await launchRenderer();
  index = await fixtureTokenIndex();
  const page = await renderer.open({ file: join(examples, "visual/base.html") });
  baseline = (await page.capture()).png;
  await page.close();
});

afterAll(async () => {
  await renderer.close();
});

async function run(fixture: Fixture): Promise<CheckFinding[]> {
  const page = await renderer.open({ file: fixture.file });
  try {
    const propsOf = (part: string, instance: number): PropValues => fixture.props?.[part]?.[instance] ?? {};
    switch (fixture.check) {
      case "a11y": {
        const { findings } = checkAxe(await page.axe());
        if (fixture.spec === undefined) return findings;
        const inspection = await page.inspect({ styles: false });
        return [
          ...findings,
          ...checkSpecA11y({ spec: fixture.spec, elements: inspection.elements, props: propsOf }),
          ...checkSpecAria(fixture.spec, ariaObservations(inspection.elements)),
        ];
      }
      case "tokens": {
        const inspection = await page.inspect({ accessibility: false });
        const component = inspection.elements.find((e) => e.parent === undefined)?.part ?? "";
        const expected =
          fixture.tokenRules === undefined
            ? undefined
            : tokenRuleExpectations(fixture.tokenRules, { component, props: propsOf });
        return checkTokens({ elements: inspection.elements, index, ...(expected === undefined ? {} : { expected }) });
      }
      case "layout":
        return checkLayout(await page.inspect({ styles: false }));
      case "visual": {
        const capture = await page.capture();
        const { width, height } = decodePng(capture.png);
        expect([width, height]).toEqual([
          Math.round(capture.clip.width * renderDefaults.deviceScaleFactor),
          Math.round(capture.clip.height * renderDefaults.deviceScaleFactor),
        ]);
        const result = checkVisualStory({ capture: capture.png, baseline });
        return result.finding === undefined ? [] : [result.finding];
      }
      default:
        throw new Error(`${fixture.name} names an unknown check ${fixture.check}.`);
    }
  } finally {
    await page.close();
  }
}

describe("the rendered checks' fixtures", () => {
  it.each(fixtures.map((f) => [`${f.name}: ${f.check} expects ${f.expect}`, f] as const))("%s", async (_, fixture) => {
    const findings = await run(fixture);
    const summary = findings.map((f) => `${f.rule} ${f.selector ?? ""}: ${f.message}`);
    if (fixture.expect === "pass") {
      expect(summary).toEqual([]);
    } else {
      expect(findings.length, `no ${fixture.expect} finding`).toBeGreaterThan(0);
      expect(
        summary.filter((_line, i) => findings[i]?.rule !== fixture.expect),
        "findings of other rules",
      ).toEqual([]);
    }
    console.info(`${fixture.name}: ${fixture.expect === "pass" ? "pass" : summary.join("\n  ")}`);
  });
});
