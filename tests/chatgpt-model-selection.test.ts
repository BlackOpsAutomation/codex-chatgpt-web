import { expect, test } from "bun:test";
import { assertRequestedEffortAvailable, chatGptModelFamilyMatches, resolveRequestedChatGptMode, selectChatGptModelFamily } from "../src/adapters/chatgpt-web/model-selection";

test("model selection recognizes Latest in the launcher languages without accepting other model names", async () => {
  for (const [label, accepted] of [
    ["Latest", true], ["最新", true], ["최신", true], ["GPT-6 Pro", true],
    ["GPT-5.6 Sol", false], ["GPT-7 Pro", false], ["Latest preview", false],
  ] as const) {
    const menu = { menu: {
      getByRole: (_role: string, options: { name: RegExp }) => ({
        count: async () => options.name.test(label) ? 1 : 0,
        getAttribute: async () => "true",
        waitFor: async () => { throw new Error("Requested family is absent"); },
      }),
      locator: () => ({ count: async () => 1, getAttribute: async () => "true" }),
    } } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
    const selection = selectChatGptModelFamily(menu, "6", async () => menu);
    if (accepted) expect(await selection).toBe(menu);
    else await expect(selection).rejects.toThrow("could not be selected and verified");
  }
});

test("family confirmation separates Latest staging from the actual Pro response", () => {
  expect(chatGptModelFamilyMatches(["5.6 High, 3 of 5."], "5.6", "high")).toBe(true);
  expect(chatGptModelFamilyMatches(["5.6 Extra High, 4 of 5."], "6", "xhigh")).toBe(true);
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "6", "max")).toBe(true);
  expect(chatGptModelFamilyMatches(["GPT-5.6 Sol Pro, 5 of 5."], "5.6", "max")).toBe(true);
  for (const descriptions of [[], ["Try Pro for more reasoning"], ["5.6 High, 3 of 5."], ["5.6 Pro, 5 of 5."],
    ["7 Pro, 5 of 5."], ["6 Sol Pro, 5 of 5."], ["6 Pro, 5 of 5.", "5.6 Pro, 5 of 5."], ["6 Pro for better answers"]]) {
    expect(chatGptModelFamilyMatches(descriptions, "6", "max")).toBe(false);
  }
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "5.6", "max")).toBe(false);
  expect(chatGptModelFamilyMatches(["6 Pro, 5 of 5."], "6", "xhigh")).toBe(false);
});

const instantOnly = { min: 0, max: 0, value: 0, available: [true], disabled: true };

test("disabled Instant-only state accepts its sole unlocked selected position", () => {
  const requested = resolveRequestedChatGptMode("gpt-5.6-sol", "none");
  assertRequestedEffortAvailable(instantOnly, 0, requested.effort);
});

for (const [effort, index] of [["medium", 1], ["high", 2], ["xhigh", 3], ["max", 4]] as const) {
  test(`disabled Instant-only state rejects ${effort}`, () => {
    expect(() => assertRequestedEffortAvailable(instantOnly, index, effort))
      .toThrow(expect.objectContaining({ code: "reasoning_not_available", retryable: false }));
  });
}

for (const [name, change] of [
  ["locked", { available: [false] }],
  ["missing tick", { available: [] }],
  ["extra contradictory tick", { available: [true, true] }],
  ["selection outside range", { value: 1 }],
  ["disabled multi-position", { max: 1, available: [true, true] }],
] satisfies Array<[string, Partial<typeof instantOnly>]>) {
  test(`disabled control fails closed with ${name}`, () => {
    expect(() => assertRequestedEffortAvailable({ ...instantOnly, ...change }, 0, "low"))
      .toThrow(expect.objectContaining({ code: "reasoning_not_available", retryable: false }));
  });
}

test("enabled multi-position availability preserves Medium High and Extra High locks", () => {
  const state = { min: 0, max: 3, value: 0, available: [true, true, true, true], disabled: false };
  for (const [effort, index] of [["medium", 1], ["high", 2], ["xhigh", 3]] as const) {
    assertRequestedEffortAvailable(state, index, effort);
    expect(() => assertRequestedEffortAvailable({ ...state, available: state.available.map((_, i) => i !== index) }, index, effort))
      .toThrow(expect.objectContaining({ code: "reasoning_not_available" }));
  }
});

test("reasoning indices outside the verified range fail closed", () => {
  for (const index of [-1, 1, 0.5, NaN]) {
    expect(() => assertRequestedEffortAvailable(instantOnly, index, "low"))
      .toThrow(expect.objectContaining({ code: "reasoning_not_available" }));
  }
});
