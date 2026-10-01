import { expect, spyOn, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { describePromptMismatch, snapshotPromptMismatchDom, type PromptDiagnosticCapture, type PromptMismatchDiagnostic } from "../src/adapters/chatgpt-web/prompt-mismatch-diagnostics";

// Private methods are exercised as a typed test seam, without widening the production API.
const methods = ChatGptBrowserWorker.prototype as unknown as {
  assertPromptAttached(page: Page, prompt: string, signal?: AbortSignal, capture?: PromptDiagnosticCapture): Promise<void>;
  attachPrompt(page: Page, prompt: string, localTools: boolean, capture?: PromptDiagnosticCapture): Promise<void>;
};

test("prompt mismatch evidence identifies equal-length substitution and preserves bounded suffix alignment", () => {
  const expected = `${"a".repeat(1941)}X${"b".repeat(1418)}`;
  const actual = `${"a".repeat(1941)}Y${"b".repeat(1418)}`;
  const evidence = describePromptMismatch(expected, actual, 1941);
  expect(evidence).toMatchObject({expectedChars: 3360, actualChars: 3360,
    rawCommonPrefixChars: 1941, equivalentCommonPrefixChars: 1941, rawCommonSuffixChars: 1418,
    firstDifference: {offset: 1941, expectedCodeUnit: "0x0058", actualCodeUnit: "0x0059"},
    suffixRealignment: {expectedOffset: 1942, actualOffset: 1942, offsetDelta: 0}});
  expect(evidence.expectedContext.chars).toBe(64);
  expect(evidence.actualContext.chars).toBe(64);
  expect(evidence.expectedContext.escapedText).toContain("X");
  expect(evidence.actualContext.escapedText).toContain("Y");
  expect(JSON.stringify(evidence)).not.toContain(expected);
  expect(JSON.stringify(evidence)).not.toContain(actual);
});

for (const [expected, actual, delta] of [["prefixTAIL", "prefix+TAIL", 1], ["prefix+TAIL", "prefixTAIL", -1]] as const)
test(`prompt mismatch insertion/deletion realigns suffix with offset delta ${delta}`, () => {
  const evidence = describePromptMismatch(expected, actual, 6);
  expect(evidence.rawCommonPrefixChars).toBe(6);
  expect(evidence.rawCommonSuffixChars).toBe(4);
  expect(evidence.suffixRealignment?.offsetDelta).toBe(delta);
  expect(evidence.firstDifference.expectedCodeUnit).not.toBe(evidence.firstDifference.actualCodeUnit);
});

test("prompt mismatch contexts visibly escape controls and report Unicode code units and code points", () => {
  const expected = "a\n\t\r\u0000\u007f\u0085\u00a0😀end";
  const actual = expected.replace("😀", "😁");
  const evidence = describePromptMismatch(expected, actual, 9);
  expect(evidence.firstDifference).toMatchObject({offset: 9, expectedCodeUnit: "0xde00", actualCodeUnit: "0xde01",
    expectedCodePoint: {offset: 8, value: "U+1F600"}, actualCodePoint: {offset: 8, value: "U+1F601"}});
  expect(evidence.expectedContext.escapedText).toContain("\\n\\t\\r\\u0000\\u007f\\u0085\\u00a0");
  expect(evidence.expectedContext.escapedText).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  expect(evidence.expectedContext.containsNbsp).toBeTrue();
  expect(evidence.expectedLineBoundaries).toEqual({previous: 3, next: null});
  expect(evidence.expectedContext.codePoints).toContainEqual({offset: 8, value: "U+1F600"});
});

test("prompt mismatch context windows do not invent unpaired source surrogates", () => {
  const expected = `a😀${"b".repeat(31)}X${"c".repeat(30)}😀tail`;
  const evidence = describePromptMismatch(expected, expected.replace("X", "Y"), 34);
  expect(evidence.expectedContext.start).toBe(3);
  expect(evidence.expectedContext.end).toBe(65);
  expect(evidence.expectedContext.chars).toBe(62);
  expect(evidence.expectedContext.codePoints.some(point => ["U+DE00", "U+D83D"].includes(point.value))).toBeFalse();
  const broken = describePromptMismatch("a\ud83dXtail", "a\ud83dYtail", 2);
  expect(broken.expectedContext.codePoints).toContainEqual({offset: 1, value: "U+D83D"});
});

test("prompt mismatch retains the true failure after an earlier equivalent NBSP, within 128 units per side", () => {
  const expected = `a  b${"x".repeat(200)}Ztail`;
  const actual = `a\u00a0 b${"x".repeat(200)}Qtail`;
  const evidence = describePromptMismatch(expected, actual, 204);
  expect(evidence.rawCommonPrefixChars).toBe(1);
  expect(evidence.firstUnequivalentDifference).toMatchObject({offset: 204, expectedCodeUnit: "0x005a", actualCodeUnit: "0x0051"});
  expect(evidence.expectedFailureContext?.escapedText).toContain("Z");
  expect(evidence.actualFailureContext?.escapedText).toContain("Q");
  expect(evidence.expectedContext.chars + (evidence.expectedFailureContext?.chars ?? 0)).toBeLessThanOrEqual(128);
  expect(evidence.actualContext.chars + (evidence.actualFailureContext?.chars ?? 0)).toBeLessThanOrEqual(128);
});

test("prompt mismatch contexts never retain a complete short input and handle end-of-input", () => {
  for (const [expected, actual, prefix] of [["abc", "abd", 2], ["", "x", 0], ["x", "", 0], ["abcdef", "abc", 3]] as const) {
    const evidence = describePromptMismatch(expected, actual, prefix);
    if (expected.length) expect(evidence.expectedContext.chars).toBeLessThan(expected.length);
    if (actual.length) expect(evidence.actualContext.chars).toBeLessThan(actual.length);
  }
  expect(describePromptMismatch("abc", "abcd", 3).firstDifference.expectedCodeUnit).toBeNull();
});

for (const observed of ["a  b", "a\u00a0 b"])
test(`prompt verification creates no diagnostic for ${observed.includes("\u00a0") ? "equivalent NBSP" : "equal text"}`, async () => {
  let captures = 0;
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {attachedPromptText: async () => observed});
  await methods.assertPromptAttached.call(worker, {} as Page, "a  b", undefined, async () => {captures++;});
  expect(captures).toBe(0);
});

for (const failCapture of [false, true])
test(`prompt mismatch fails before Send and cleans up after ${failCapture ? "failed" : "successful"} diagnostic capture`, async () => {
  const order: string[] = [];
  let draft = "";
  let sends = 0;
  let captured: PromptMismatchDiagnostic | undefined;
  const composer = {fill: async () => {draft = "";}, focus: async () => {}, evaluate: async () => {throw new Error("DOM snapshot unavailable");}};
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    activeComposer: async () => composer,
    insertPromptText: async () => {draft = "abd";}, attachedPromptText: async () => draft,
    clearChatGptComposerState: async () => {order.push("cleanup"); draft = "";},
  });
  const absent = {filter() {return this;}, last() {return this;}, isVisible: async () => false};
  const page = {locator: () => absent} as unknown as Page;
  const now = Date.now();
  let clockReads = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now + clockReads++ * 5_000);
  try {
    await expect((async () => {
      await methods.attachPrompt.call(worker, page, "abc", false, async (checkpoint, mismatch) => {
        order.push(checkpoint); captured = mismatch;
        expect(draft).toBe("abd");
        if (failCapture) throw new Error("disk unavailable");
      });
      sends++;
    })()).rejects.toMatchObject({code: "prompt_attachment_integrity", retryable: false});
  } finally {clock.mockRestore();}
  expect(order).toEqual(["prompt-attachment-integrity-mismatch", "cleanup"]);
  expect(captured).toMatchObject({expectedChars: 3, actualChars: 3, rawCommonPrefixChars: 2, domCaptureFailed: true});
  expect(draft).toBe("");
  expect(sends).toBe(0);
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("prompt mismatch DOM snapshot maps paragraph and br boundaries without storing text or attributes", async () => {
  const browser = await chromium.launch({executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="prompt-textarea" contenteditable="true"><p>alpha</p><p>be<br>ta</p><div>gamma</div></div>');
    const snapshot = await page.locator("#prompt-textarea").evaluate(snapshotPromptMismatchDom, 8);
    expect(snapshot.text).toBe("alpha\nbeta\ngamma");
    expect(snapshot.structure.targetTopLevelIndex).toBe(1);
    expect(snapshot.structure.nodes).toContainEqual({path: [1, 1], nodeType: 1, tag: "BR", start: 8, end: 8, textChars: 0, childCount: 0});
    expect(snapshot.structure.nodes).toContainEqual({path: [1], nodeType: 1, tag: "P", start: 6, end: 10, textChars: 4, childCount: 3});
    expect(JSON.stringify(snapshot.structure)).not.toContain("alpha");
    await page.setContent(`<div id="prompt-textarea"><p>${"<span></span>".repeat(100)}</p></div>`);
    const capped = await page.locator("#prompt-textarea").evaluate(snapshotPromptMismatchDom, 0);
    expect(capped.structure.nodes.length).toBeLessThanOrEqual(24);
    expect(capped.structure.truncated).toBeTrue();
  } finally {await browser.close();}
});
