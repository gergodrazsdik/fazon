// SPDX-License-Identifier: GPL-3.0-or-later
// The judge's credential, prices and image limits.
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { judgeCredential, judgeSdkClient } from "./credentials.js";
import { fitPng, fittedSize, maxLongEdge, maxVisualTokens, visualTokens } from "./images.js";
import { costOf, frameworkPrices, priceOf } from "./prices.js";

const federation = {
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
  ANTHROPIC_ORGANIZATION_ID: "org_1",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
  ANTHROPIC_IDENTITY_TOKEN_FILE: "/run/token",
};

describe("judgeCredential", () => {
  it("prefers an API key, as the SDK would", () => {
    expect(judgeCredential({ ANTHROPIC_API_KEY: "key", ...federation })).toEqual({ kind: "api-key", apiKey: "key" });
  });

  it("takes federation when all four variables are set, the workspace optional", () => {
    expect(judgeCredential(federation)).toEqual({
      kind: "federation",
      federationRuleId: "fdrl_1",
      organizationId: "org_1",
      serviceAccountId: "svac_1",
      identityTokenFile: "/run/token",
    });
    expect(judgeCredential({ ...federation, ANTHROPIC_WORKSPACE_ID: "wrkspc_1" })).toMatchObject({
      workspaceId: "wrkspc_1",
    });
  });

  it("gives none without a key or a complete set, and ignores other sources such as a profile", () => {
    expect(judgeCredential({})).toBeUndefined();
    expect(judgeCredential({ ANTHROPIC_API_KEY: " " })).toBeUndefined();
    expect(judgeCredential({ ...federation, ANTHROPIC_IDENTITY_TOKEN_FILE: "" })).toBeUndefined();
    expect(judgeCredential({ ANTHROPIC_PROFILE: "work", ANTHROPIC_AUTH_TOKEN: "token" })).toBeUndefined();
  });

  it("builds a client for either credential without a request", () => {
    expect(judgeSdkClient({ kind: "api-key", apiKey: "key" })).toBeDefined();
    const credential = judgeCredential(federation);
    if (credential === undefined) throw new Error("no credential");
    expect(judgeSdkClient(credential)).toBeDefined();
  });
});

describe("prices", () => {
  it("has the judge models in the framework's table, and the config's override it", () => {
    expect(priceOf({}, "claude-sonnet-5-5")).toEqual(frameworkPrices["claude-sonnet-5-5"]);
    expect(priceOf({ "claude-sonnet-5-5": { input: 1, output: 1 } }, "claude-sonnet-5-5")).toEqual({
      input: 1,
      output: 1,
    });
    expect(priceOf({}, "claude-unknown")).toBeUndefined();
  });

  it("costs tokens per million, with cache prices derived when the price has none, and a batch discount", () => {
    const tokens = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
    expect(costOf(tokens, { input: 2, output: 10 })).toBeCloseTo(2 + 10 + 0.2 + 2.5, 10);
    expect(costOf(tokens, { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, 0.5)).toBeCloseTo(7.3, 10);
  });
});

describe("image limits", () => {
  it("counts 28 px patches, as the vision docs do", () => {
    expect(visualTokens(600, 400)).toBe(330);
    expect(visualTokens(2048, 1536)).toBe(4070);
  });

  it("keeps a story crop as it is and scales a larger image down proportionally", () => {
    expect(fittedSize(2048, 1536)).toEqual({ width: 2048, height: 1536 });
    const wide = fittedSize(5000, 1000);
    expect(wide.width).toBeLessThanOrEqual(maxLongEdge);
    const big = fittedSize(3000, 3000);
    expect(visualTokens(big.width, big.height)).toBeLessThanOrEqual(maxVisualTokens);
    expect(big.width).toBe(big.height);
  });

  it("fitPng returns a fitting PNG unchanged and averages a larger one down", () => {
    const small = new PNG({ width: 2, height: 2 });
    small.data.fill(200);
    const smallPng = PNG.sync.write(small);
    expect(fitPng(smallPng)).toBe(smallPng);
    const large = new PNG({ width: 3000, height: 100 });
    large.data.fill(100);
    const fitted = PNG.sync.read(fitPng(PNG.sync.write(large)));
    expect(fitted.width).toBeLessThanOrEqual(maxLongEdge);
    expect(fitted.data[0]).toBe(100);
  });
});
