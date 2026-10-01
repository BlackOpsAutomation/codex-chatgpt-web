import {expect, test} from "bun:test";
import {chromium, type Locator, type Page} from "playwright-core";
import {ChatGptBrowserWorker, insertPlainTextIntoComposer} from "../src/adapters/chatgpt-web/browser-worker";
import type {PromptDiagnosticCapture} from "../src/adapters/chatgpt-web/prompt-mismatch-diagnostics";

// Private verification methods remain private in production.
interface FidelityMethods {
  promptTextEquivalent(expected: string, actual: string): boolean;
  attachedPromptText(page: Page): Promise<string>;
  assertPromptAttached(page: Page, prompt: string): Promise<void>;
  attachPrompt(page: Page, prompt: string, localTools: boolean, capture?: PromptDiagnosticCapture): Promise<void>;
}
const prototype = ChatGptBrowserWorker.prototype as unknown as FidelityMethods;

test("line-leading NBSP equivalence is directional and preserves every unrelated mutation guard", () => {
  const compare = (expected: string, actual: string) => prototype.promptTextEquivalent(expected, actual);
  expect(compare("a\n b", "a\n\u00a0b")).toBeTrue();
  expect(compare("a\n - item", "a\n\u00a0- item")).toBeTrue();
  expect(compare("a\n\u00a0b", "a\n b")).toBeFalse();
  expect(compare("a b", "a\u00a0b")).toBeFalse();
  expect(compare(" b", "\u00a0b")).toBeFalse();
  expect(compare("a\r b", "a\r\u00a0b")).toBeFalse();
  expect(compare("a \nb", "a\u00a0\nb")).toBeFalse();
  expect(compare("a\n b", "a\n\tb")).toBeFalse();
  expect(compare("a\n b", "a \u00a0b")).toBeFalse();
  expect(compare("a\n b", "a\n\u00a0c")).toBeFalse();
  expect(compare("a\n b", "a\n\u00a0 b")).toBeFalse();
  expect(compare("a\n  b", "a\n\u00a0 b")).toBeTrue();
  expect(compare("a  b", "a\u00a0 b")).toBeTrue();
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("native paragraph insertion preserves dashboard indentation as NBSP without Lexical and passes exact positional verification", async () => {
  const browser = await chromium.launch({executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.route("**/*", route => route.abort());
    const dashboard = '- Header:\n - "Winterstar Dashboard"\n - greeting';
    const capturedShape = `dashboard.\n\nInclude:\n\n${dashboard}`;
    const alignedShape = `${"x".repeat(1941 - capturedShape.indexOf("\n - ") - 1)}${capturedShape}`;
    const longShape = alignedShape + "z".repeat(3360 - alignedShape.length);
    const prompts = ["hello", "one\ntwo", "a\n b", "a\n  b", "1. first\n 1. nested", dashboard, longShape];
    for (const prompt of prompts) for (const whiteSpace of ["normal", "pre-wrap"]) {
      await page.setContent(`<div id="prompt-textarea" contenteditable="true" style="white-space:${whiteSpace}"><p><br></p></div>`, {waitUntil: "domcontentloaded"});
      const composer = page.locator("#prompt-textarea");
      const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {activeComposer: async () => composer}) as FidelityMethods;
      expect(await composer.evaluate(insertPlainTextIntoComposer, prompt)).toBeTrue();
      const actual = await worker.attachedPromptText(page);
      expect(actual.length).toBe(prompt.length);
      if (whiteSpace === "normal" && prompt.includes("\n ")) {
        expect(actual).toContain("\n\u00a0");
        if (prompt === longShape) {
          expect(prompt[1941]).toBe(" ");
          expect(actual[1941]).toBe("\u00a0");
        }
      } else expect(actual).toBe(prompt);
      await worker.assertPromptAttached(page, prompt);
      expect(worker.promptTextEquivalent(prompt, actual)).toBeTrue();
    }
  } finally {await browser.close();}
}, 30_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("real composer mismatch still rejects, captures bounded evidence, clears draft and never submits", async () => {
  const browser = await chromium.launch({executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true});
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3_000);
    await page.route("**/*", route => route.abort());
    await page.setContent('<form data-chatgpt-composer><div id="prompt-textarea" contenteditable="true" style="white-space:normal"></div><button type="submit">Send</button></form>', {waitUntil: "domcontentloaded"});
    await page.evaluate(() => {
      Reflect.set(window, "submitCount", 0);
      document.querySelector("form")!.addEventListener("submit", event => {event.preventDefault(); Reflect.set(window, "submitCount", 1);});
      document.querySelector("#prompt-textarea")!.addEventListener("input", event => {
        const walk = document.createTreeWalker(event.target as Node, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walk.nextNode())) {
          if (node.textContent?.includes("literalX")) node.textContent = node.textContent.replace("literalX", "literalY");
        }
      });
    });
    const worker = ChatGptBrowserWorker.forProvider({adapter: "chatgpt-web", baseUrl: `browser://offline-fidelity-${crypto.randomUUID()}`}) as unknown as FidelityMethods & {activeComposer(page: Page): Promise<Locator>};
    worker.activeComposer = async () => page.locator("#prompt-textarea");
    const prompt = "- Header:\n - literalX";
    let checkpoint: string | undefined;
    let failingOffset: number | undefined;
    let failure: unknown;
    try {
      await worker.attachPrompt(page, prompt, false, async (name, evidence) => {
        checkpoint = name;
        failingOffset = evidence?.equivalentCommonPrefixChars;
        expect(await page.locator("#prompt-textarea").textContent()).toContain("literalY");
      });
    } catch (error) {failure = error;}
    expect(failure).toMatchObject({code: "prompt_attachment_integrity", retryable: false});
    expect(checkpoint).toBe("prompt-attachment-integrity-mismatch");
    expect(failingOffset).toBe(prompt.indexOf("X"));
    expect(await page.locator("#prompt-textarea").textContent()).toBe("");
    expect(await page.evaluate(() => Reflect.get(window, "submitCount"))).toBe(0);
  } finally {await browser.close();}
}, 30_000);
