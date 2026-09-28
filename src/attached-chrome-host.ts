import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { assertLoopbackBrowserAttachEndpoint } from "./config";

const CHATGPT_PAGE_HOSTS: Record<string, true> = {
  "chatgpt.com": true,
  "www.chatgpt.com": true,
};

export interface AttachedPageCandidate {
  url(): string;
}

export interface AttachedContextCandidate<TPage extends AttachedPageCandidate> {
  pages(): TPage[];
}

export interface AttachedChromeConnection {
  browser: Browser;
  context: BrowserContext;
}

export interface AttachedChromePage {
  context: BrowserContext;
  page: Page;
  created: boolean;
}

export function isChatGptPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CHATGPT_PAGE_HOSTS[url.hostname] === true;
  } catch {
    return false;
  }
}

/**
 * Choose an existing ChatGPT tab by URL only. Unrelated pages are never selected.
 * The caller creates a page in the existing context when this returns undefined.
 */
export function selectAttachedChatGptPage<TPage extends AttachedPageCandidate>(
  contexts: ReadonlyArray<AttachedContextCandidate<TPage>>,
): { contextIndex: number; page: TPage } | undefined {
  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
    for (const page of contexts[contextIndex].pages()) {
      if (isChatGptPageUrl(page.url())) return { contextIndex, page };
    }
  }
  return undefined;
}

/**
 * Attach to an already-running Chrome. Playwright's connectOverCDP close path only
 * closes the CDP transport: CRBrowser.connect is given a browserProcess whose close
 * and kill handlers are closeAndWait() plus artifact cleanup, not a process signal.
 */
export async function connectAttachedChrome(endpoint: string): Promise<AttachedChromeConnection> {
  const browser = await chromium.connectOverCDP(assertLoopbackBrowserAttachEndpoint(endpoint));
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error("Attached Chrome did not expose an existing browser context");
  }
  return { browser, context };
}

export async function pageForAttachedChrome(browser: Browser): Promise<AttachedChromePage> {
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error("Attached Chrome did not expose an existing browser context");
  const selected = selectAttachedChatGptPage(contexts);
  if (selected) {
    return { context: contexts[selected.contextIndex], page: selected.page, created: false };
  }
  const context = contexts[0];
  return { context, page: await context.newPage(), created: true };
}
