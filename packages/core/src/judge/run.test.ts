// SPDX-License-Identifier: GPL-3.0-or-later
// The judge's calls against a fake client: verdicts, repeats and the majority, declined and
// failed calls, the budget (JUDGE-004), the cost, and each story's verdict (JUDGE-003).
import Anthropic from "@anthropic-ai/sdk";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { JudgeCall, JudgePlan } from "./plan.js";
import { JudgeCredentialError, runJudge, type JudgeClient, type RunJudgeInput, type Verdict } from "./run.js";

const png = (() => {
  const image = new PNG({ width: 4, height: 4 });
  image.data.fill(255);
  return PNG.sync.write(image);
})();

function call(question: string, stories: readonly string[], theme = "light"): JudgeCall {
  return {
    question,
    source: "derived",
    kind: stories.length === 1 ? "each" : "compare",
    text: `Question ${question}?`,
    theme,
    images: stories.map((story) => ({ kind: "capture", label: story, story })),
  };
}

const plan: JudgePlan = {
  fazon: 0,
  component: "Button",
  calls: [
    call("story", ["button--a--default", "button--b--default"]),
    call("axis-variant", ["button--a--default", "button--b--default"]),
  ],
};

type Reply =
  | { verdicts: Readonly<Record<string, Verdict>>; stop?: Anthropic.StopReason }
  | { stop: Anthropic.StopReason; text?: string }
  | { error: Error };

function message(text: string, stop: Anthropic.StopReason): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/** A client that answers each call from a script, keyed by question, one reply per attempt. */
function fake(
  script: Readonly<Record<string, readonly Reply[]>>,
): JudgeClient & { requests: Anthropic.MessageCreateParamsNonStreaming[] } {
  const used = new Map<string, number>();
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    requests,
    create: (params) => {
      requests.push(params);
      const content = params.messages[0]?.content;
      const blocks = Array.isArray(content) ? content : [];
      const intro = blocks[1];
      const question = intro?.type === "text" ? (/Question `([^`]+)`/.exec(intro.text)?.[1] ?? "") : "";
      const attempt = used.get(question) ?? 0;
      used.set(question, attempt + 1);
      const reply = script[question]?.[attempt] ?? script[question]?.at(-1);
      if (reply === undefined) throw new Error(`no reply for ${question}`);
      if ("error" in reply) return Promise.reject(reply.error);
      if ("verdicts" in reply) {
        const results = Object.entries(reply.verdicts).map(([story, verdict]) => ({
          story,
          verdict,
          findings: verdict === "pass" ? [] : [{ severity: "high", message: `${story} is off` }],
        }));
        return Promise.resolve(message(JSON.stringify({ question, results }), reply.stop ?? "end_turn"));
      }
      return Promise.resolve(message(reply.text ?? "", reply.stop));
    },
  };
}

function input(client: JudgeClient, extra: Partial<RunJudgeInput> = {}): RunJudgeInput {
  return {
    plan,
    spec: { file: "specs/button.md", text: "---\nfazon: 0\n---\n" },
    model: "claude-sonnet-5-5",
    repeats: 1,
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    budgetUsd: 10,
    loadImage: () => Promise.resolve(png),
    client,
    concurrency: 1,
    now: () => 0,
    ...extra,
  };
}

const pass = { "button--a--default": "pass", "button--b--default": "pass" } as const;

describe("runJudge", () => {
  it("gives each story its verdict: fail if any call failed it", async () => {
    const outcome = await runJudge(
      input(
        fake({
          story: [{ verdicts: pass }],
          "axis-variant": [{ verdicts: { "button--a--default": "pass", "button--b--default": "fail" } }],
        }),
      ),
    );
    expect(outcome.stories.map((story) => [story.story, story.verdict])).toEqual([
      ["button--a--default", "pass"],
      ["button--b--default", "fail"],
    ]);
    expect(outcome.stories[1]?.findings).toEqual([
      {
        severity: "high",
        message: "button--b--default is off",
        question: "axis-variant",
        theme: "light",
        verdict: "fail",
      },
    ]);
  });

  it("costs each request from its usage and the price", async () => {
    const outcome = await runJudge(input(fake({ story: [{ verdicts: pass }], "axis-variant": [{ verdicts: pass }] })));
    // (1000 × 2 + 200 × 10 + 3000 × 0.1) / 1e6 per call.
    expect(outcome.costUsd).toBeCloseTo(2 * 0.0043, 10);
    expect(outcome.tokens).toEqual({ input: 2000, output: 400, cacheRead: 6000, cacheWrite: 0 });
  });

  it.each<[string, Reply, string]>([
    ["a declined call", { stop: "refusal" }, "the model declined the call"],
    ["a cut-off answer", { stop: "max_tokens", text: "{" }, "the answer was cut off at the token limit"],
    ["an answer that isn't JSON", { stop: "end_turn", text: "no" }, "the answer isn't JSON"],
    ["a failed request", { error: new Error("socket hang up") }, "the request failed: socket hang up"],
  ])("makes every image of %s unsure, with the reason", async (_, reply, reason) => {
    const outcome = await runJudge(input(fake({ story: [reply], "axis-variant": [{ verdicts: pass }] })));
    const record = outcome.calls[0];
    expect(record?.images?.map((image) => image.verdict)).toEqual(["unsure", "unsure"]);
    expect(record?.images?.[0]?.reason).toBe(reason);
    expect(outcome.stories.map((story) => story.verdict)).toEqual(["unsure", "unsure"]);
    expect(outcome.stories[0]?.reasons).toEqual([`story (light): ${reason}`]);
  });

  it("makes an image the answer leaves out unsure", async () => {
    const outcome = await runJudge(
      input(fake({ story: [{ verdicts: { "BUTTON--A--DEFAULT": "pass" } }], "axis-variant": [{ verdicts: pass }] })),
    );
    expect(outcome.calls[0]?.images?.map((image) => [image.verdict, image.reason])).toEqual([
      ["pass", undefined],
      ["unsure", "the answer gave this image no verdict"],
    ]);
  });

  it("takes the majority over the repeats, and a tie is unsure", async () => {
    const outcome = await runJudge(
      input(
        fake({
          story: [
            { verdicts: { "button--a--default": "fail", "button--b--default": "pass" } },
            { verdicts: { "button--a--default": "fail", "button--b--default": "fail" } },
            { verdicts: { "button--a--default": "pass", "button--b--default": "unsure" } },
          ],
          "axis-variant": [{ verdicts: pass }],
        }),
        { repeats: 3 },
      ),
    );
    const images = outcome.calls[0]?.images ?? [];
    expect(images.map((image) => image.verdict)).toEqual(["fail", "unsure"]);
    expect(images[0]?.findings).toEqual([{ severity: "high", message: "button--a--default is off" }]);
    expect(images[1]?.reason).toBe("the repeats disagreed, with no majority");
    expect(outcome.calls[0]?.attempts).toHaveLength(3);
  });

  it("starts no call once the budget is spent, and reports the rest as not judged (JUDGE-004, JUDGE-003)", async () => {
    const client = fake({ story: [{ verdicts: pass }], "axis-variant": [{ verdicts: pass }] });
    const wide: JudgePlan = { ...plan, calls: [...plan.calls, call("state-hover", ["button--c--hover"])] };
    const outcome = await runJudge(input(client, { plan: wide, budgetUsd: 0.004 }));
    expect(client.requests).toHaveLength(1);
    expect(outcome.calls.map((record) => record.skipped)).toEqual([
      undefined,
      "the judge's budget was spent",
      "the judge's budget was spent",
    ]);
    expect(outcome.stories.map((story) => [story.story, story.verdict])).toEqual([
      ["button--a--default", "pass"],
      ["button--b--default", "pass"],
      ["button--c--hover", "not-judged"],
    ]);
    expect(outcome.stories[2]?.reasons).toEqual(["the judge's budget was spent"]);
  });

  it("makes the first call alone, so that it writes the cached prefix before the others read it", async () => {
    const events: string[] = [];
    let open = 0;
    const client: JudgeClient = {
      create: async (params) => {
        const content = params.messages[0]?.content;
        const intro = Array.isArray(content) ? content[1] : undefined;
        const question = intro?.type === "text" ? (/Question `([^`]+)`/.exec(intro.text)?.[1] ?? "") : "";
        events.push(`start ${question} (${String(open++)} open)`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        open--;
        const results = ["button--a--default", "button--b--default", "button--c--hover"].map((story) => ({
          story,
          verdict: "pass",
          findings: [],
        }));
        return message(JSON.stringify({ question, results }), "end_turn");
      },
    };
    const wide: JudgePlan = { ...plan, calls: [...plan.calls, call("state-hover", ["button--c--hover"])] };
    await runJudge(input(client, { plan: wide, concurrency: 4 }));
    expect(events).toEqual(["start story (0 open)", "start axis-variant (0 open)", "start state-hover (1 open)"]);
  });

  it("stops with JudgeCredentialError when the API refuses the credential", async () => {
    const refused = new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers());
    await expect(runJudge(input(fake({ story: [{ error: refused }] })))).rejects.toBeInstanceOf(JudgeCredentialError);
  });

  it("marks a call's images unsure when an image can't be read", async () => {
    const outcome = await runJudge(
      input(fake({ "axis-variant": [{ verdicts: pass }] }), {
        loadImage: (image, entry) =>
          entry.question === "story" ? Promise.reject(new Error(`no file for ${image.label}`)) : Promise.resolve(png),
      }),
    );
    expect(outcome.calls[0]?.images?.[0]?.reason).toBe("an image couldn't be read: no file for button--a--default");
  });
});
