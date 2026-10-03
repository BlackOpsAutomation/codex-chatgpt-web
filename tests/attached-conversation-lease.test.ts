import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { chromium } from "playwright-core";
import {
  ATTACHED_LEASE_MARKER_PROPERTY,
  attachedConversationLeaseRequested,
} from "../src/adapters/chatgpt-web/attached-conversation-lease";
const FIRST_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const OTHER_CHAT_URL = "https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function barrier<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function leasePage() {
  let closed = false;
  let url = FIRST_CHAT_URL;
  let closes = 0;
  const store = new Map<string, string>();
  let anchors = ["turn:first-user"];
  return {
    url: () => url,
    setUrl: (value: string) => { url = value; },
    setAnchors: (values: string[]) => { anchors = values; },
    closes: () => closes,
    isClosed: () => closed,
    close: async () => {
      closed = true;
      closes += 1;
    },
    dropMarker: () => {
      store.clear();
    },
    replaceDocument: () => {
      store.clear();
      anchors = [];
    },
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => {
      if (closed) throw new Error("page closed");
      if (arg && typeof arg === "object" && "property" in arg && "value" in arg) {
        const stamp = arg as { property: string; value: string };
        store.set(stamp.property, stamp.value);
        return undefined;
      }
      if (arg && typeof arg === "object" && "userTurnSelector" in arg) {
        const expected = "expected" in arg && typeof arg.expected === "string" ? arg.expected : undefined;
        if (new Set(anchors).size !== anchors.length
          || (expected && anchors.filter(value => value === expected).length !== 1)) return undefined;
        return expected && !("advance" in arg && arg.advance === true) ? expected : anchors.at(-1);
      }
      if (typeof arg === "string") return store.get(arg);
      return fn(arg);
    },
  };
}

function workerFor(host: string, page = leasePage()) {
  const calls: Array<{ reuse?: boolean; owned?: unknown; argc: number }> = [];
  let created = 0;
  let killed = false;
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { browserHost: host },
    activeRuns: new Map(),
    attachedOwnedPages: new Map(),
    browser: {
      close: async () => {},
      kill: () => {
        killed = true;
      },
    },
    pageForNewTurn: async () => {
      // Acquisition can be overridden by a controlled barrier in race tests.
      created += 1;
      return page;
    },
    runBrowserTurn: async (
      _turn: unknown,
      _surface?: unknown,
      _maintenance?: unknown,
      reuse?: boolean,
      _usage?: boolean,
      owned?: unknown,
    ) => {
      calls.push({ reuse, owned, argc: arguments.length });
      return "ok";
    },
  }) as {
    run(turn: Record<string, unknown>): Promise<string>;
    pageForNewTurn: () => Promise<typeof page>;
    runBrowserTurn: (...args: unknown[]) => Promise<string>;
    releaseAttachedConversation(key: string): Promise<void>;
    close(): Promise<void>;
  };
  return {
    worker,
    page,
    calls,
    created: () => created,
    killed: () => killed,
  };
}

function turn(overrides: Record<string, unknown> = {}) {
  return {
    traceId: `trace_${Math.random().toString(16).slice(2)}`,
    modelId: "gpt-5.6-sol",
    modelFamily: "5.6",
    capabilities: {
      localToolsEnabled: false,
      solAvailable: true,
      extraHighAvailable: false,
      proAvailable: false,
    },
    prepare: async () => ({ text: "task", images: [], release() {} }),
    prepareResume: async () => ({ text: "result", images: [], release() {} }),
    onTextDelta: () => {},
    retainConversation: true,
    conversationKey: "lease_test_key",
    ...overrides,
  };
}

test("attached lease is not requested for launcher, managed, or unscoped turns", () => {
  const scoped = { conversationKey: "lease_test_key", retainConversation: true };
  expect(attachedConversationLeaseRequested("launcher", scoped)).toBe(false);
  expect(attachedConversationLeaseRequested("managed-chrome", scoped)).toBe(false);
  expect(attachedConversationLeaseRequested("attached-chrome", { conversationKey: "lease_test_key" })).toBe(false);
  expect(attachedConversationLeaseRequested("attached-chrome", scoped)).toBe(true);
});

test("owned attached page is reused and a lost marker does not open another page", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  expect(harness.created()).toBe(1);
  expect(harness.calls[0]?.reuse).toBe(false);
  expect(harness.calls[0]?.owned).toBe(harness.page);
  expect(harness.page.closes()).toBe(0);

  await harness.worker.run(turn({ requireRetainedConversation: true }));
  expect(harness.created()).toBe(1);
  expect(harness.calls[1]?.reuse).toBe(true);
  expect(harness.calls[1]?.owned).toBe(harness.page);

  harness.page.dropMarker();
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  expect(harness.created()).toBe(1);
  expect(harness.page.closes()).toBe(1);
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("retained conversation advances its trusted anchor through a five-turn DOM window", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main></main>");
    const harness = workerFor("attached-chrome");
    harness.page.evaluate = (fn, arg) => page.evaluate(fn, arg);
    let round = 0;
    harness.worker.runBrowserTurn = async () => {
      await page.evaluate(index => {
        const group = document.createElement("div");
        group.setAttribute("data-turn-key", `window-${index}`);
        const user = document.createElement("div");
        user.setAttribute("data-user-message-bubble", "");
        group.append(user);
        document.querySelector("main")!.append(group);
        const groups = document.querySelectorAll("[data-turn-key]");
        if (groups.length > 5) groups[0]!.remove();
      }, ++round);
      return `response-${round}`;
    };
    expect(await harness.worker.run(turn())).toBe("response-1");
    for (let next = 2; next <= 9; next++) {
      expect(await harness.worker.run(turn({ requireRetainedConversation: true }))).toBe(`response-${next}`);
    }
    expect(await page.locator('[data-turn-key="window-1"]').count()).toBe(0);
    expect(harness.created()).toBe(1);
    expect(harness.page.closes()).toBe(0);
    // The marker and URL alone must not authorize a replacement conversation.
    harness.worker.runBrowserTurn = async () => {
      ++round;
      await page.locator("main").evaluate(element => { element.innerHTML = '<div data-turn-key="untrusted"><div data-user-message-bubble></div></div>'; });
      return "untrusted-response";
    };
    await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
    expect(round).toBe(10);
    expect(harness.page.closes()).toBe(1);
  } finally { await browser.close(); }
}, 30_000);

test("release and worker close close only the owned page and do not kill Chrome", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  await harness.worker.releaseAttachedConversation("lease_test_key");
  expect(harness.page.closes()).toBe(1);
  expect(harness.killed()).toBe(false);

  const second = workerFor("attached-chrome");
  await second.worker.run(turn());
  await second.worker.close();
  expect(second.page.closes()).toBe(1);
  expect(second.killed()).toBe(false);
});

test("failed page close retains the cancelled lease until cleanup succeeds", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  const closePage = harness.page.close;
  let attempts = 0;
  harness.page.close = async () => {
    if (++attempts === 1) throw new Error("page close failed");
    await closePage();
  };
  await expect(harness.worker.releaseAttachedConversation("lease_test_key")).rejects.toThrow("page close failed");
  expect(harness.page.closes()).toBe(0);
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  await expect(harness.worker.run(turn())).rejects.toThrow("already open");
  await harness.worker.releaseAttachedConversation("lease_test_key");
  expect(harness.page.closes()).toBe(1);
  expect(harness.killed()).toBe(false);
});

test("failed, aborted, and timed-out turns release the owned page", async () => {
  for (const error of [
    new Error("ChatGPT browser stage timed out: effort_selection"),
    new DOMException("ChatGPT web turn aborted", "AbortError"),
  ]) {
    const harness = workerFor("attached-chrome");
    harness.worker.runBrowserTurn = async () => {
      throw error;
    };
    await expect(harness.worker.run(turn())).rejects.toThrow();
    expect(harness.page.closes()).toBe(1);
    expect(harness.created()).toBe(1);
  }
});

test("invalid, duplicate, and non-attached lease requests do not create a replacement page", async () => {
  const attached = workerFor("attached-chrome");
  await expect(attached.worker.run(turn({ conversationKey: "bad" }))).rejects.toThrow("lease key is invalid");
  expect(attached.created()).toBe(0);

  await attached.worker.run(turn());
  await expect(attached.worker.run(turn())).rejects.toThrow("already open");
  expect(attached.created()).toBe(1);

  const managed = workerFor("managed-chrome");
  managed.worker.runBrowserTurn = async function recorded(this: unknown) {
    managed.calls.push({ argc: arguments.length });
    return "managed";
  };
  await managed.worker.run(turn());
  expect(managed.created()).toBe(0);
  expect(managed.calls[0]?.argc).toBe(1);
  await managed.worker.close();
  expect(await managed.worker.run(turn())).toBe("managed");
  expect(managed.calls[1]?.argc).toBe(1);
});

test("concurrent first acquisition reserves key before page creation and release drains its late page", async () => {
  const harness = workerFor("attached-chrome");
  const pending = barrier<typeof harness.page>();
  const started = barrier<void>();
  harness.worker.pageForNewTurn = () => {
    started.resolve();
    return pending.promise;
  };
  const first = harness.worker.run(turn());
  await started.promise;
  await expect(harness.worker.run(turn())).rejects.toThrow("already open");
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  const cancelled = first;
  const released = harness.worker.releaseAttachedConversation("lease_test_key");
  await expect(harness.worker.run(turn())).rejects.toThrow("already open");
  pending.resolve(harness.page);
  await Promise.all([expect(cancelled).rejects.toThrow("no longer available"), released]);
  expect(harness.calls).toHaveLength(0);
  expect(harness.page.closes()).toBe(1);
  expect(harness.killed()).toBe(false);
});

test("failed page acquisition clears reservation without closing an unrelated tab", async () => {
  const harness = workerFor("attached-chrome");
  const unrelated = leasePage();
  const pending = barrier<typeof harness.page>();
  const started = barrier<void>();
  harness.worker.pageForNewTurn = () => {
    started.resolve();
    return pending.promise;
  };
  const first = harness.worker.run(turn());
  await started.promise;
  pending.reject(new Error("acquisition failed"));
  await expect(first).rejects.toThrow("acquisition failed");
  expect(unrelated.closes()).toBe(0);
  harness.worker.pageForNewTurn = async () => harness.page;
  await harness.worker.run(turn());
  expect(harness.page.closes()).toBe(0);
  await harness.worker.releaseAttachedConversation("lease_test_key");
  expect(harness.page.closes()).toBe(1);
  expect(unrelated.closes()).toBe(0);
});

test("concurrent continuation cannot enter the same owned page; release cancels an active turn", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  const pending = barrier<string>();
  const started = barrier<void>();
  harness.worker.runBrowserTurn = async () => {
    started.resolve();
    return pending.promise;
  };
  const inFlight = harness.worker.run(turn({ requireRetainedConversation: true }));
  await started.promise;
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  await harness.worker.releaseAttachedConversation("lease_test_key");
  pending.resolve("late");
  await expect(inFlight).rejects.toThrow("no longer available");
  expect(harness.page.closes()).toBe(1);
});

test("conversation route and document marker are both required for continuation", async () => {
  for (const changed of [
    (page: { setUrl(value: string): void }) => page.setUrl(OTHER_CHAT_URL),
    (page: { replaceDocument(): void }) => page.replaceDocument(),
  ]) {
    const harness = workerFor("attached-chrome");
    await harness.worker.run(turn());
    changed(harness.page);
    await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
    expect(harness.calls).toHaveLength(1);
    expect(harness.page.closes()).toBe(1);
  }
});

test("conversation route changing during continuation fails closed", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  harness.worker.runBrowserTurn = async () => {
    harness.page.setUrl(OTHER_CHAT_URL);
    return "late";
  };
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  expect(harness.page.closes()).toBe(1);
});

test("Temporary Chat retains by first-turn anchor without /c route", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  await harness.worker.run(turn({ requireRetainedConversation: true }));
  expect(harness.calls[1]?.owned).toBe(harness.page);
  expect(harness.page.closes()).toBe(0);
});

test("missing or ambiguous first-turn anchor after initial success cannot retain the page", async () => {
  for (const anchors of [[], ["turn:first-user", "turn:first-user"]]) {
    const harness = workerFor("attached-chrome");
    harness.page.setAnchors(anchors);
    await expect(harness.worker.run(turn())).rejects.toThrow("no longer available");
    expect(harness.page.closes()).toBe(1);
  }
});

test("Temporary Chat changing conversation under unchanged URL loses its lease", async () => {
  const harness = workerFor("attached-chrome");
  await harness.worker.run(turn());
  harness.page.setAnchors(["turn:another-user"]);
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  expect(harness.calls).toHaveLength(1);
  expect(harness.page.closes()).toBe(1);
});

test("saved conversation also retains its exact /c route and first-turn anchor", async () => {
  const harness = workerFor("attached-chrome");
  harness.page.setUrl("https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc");
  await harness.worker.run(turn());
  await harness.worker.run(turn({ requireRetainedConversation: true }));
  harness.page.setUrl(OTHER_CHAT_URL);
  await expect(harness.worker.run(turn({ requireRetainedConversation: true }))).rejects.toThrow("no longer available");
  expect(harness.page.closes()).toBe(1);
});

test("close drains acquisition and closes only its owned page without killing external Chrome", async () => {
  const harness = workerFor("attached-chrome");
  const unrelated = leasePage();
  const pending = barrier<typeof harness.page>();
  const started = barrier<void>();
  harness.worker.pageForNewTurn = () => {
    started.resolve();
    return pending.promise;
  };
  const inFlight = harness.worker.run(turn());
  await started.promise;
  const closed = harness.worker.close();
  await expect(harness.worker.run(turn())).rejects.toThrow("closing");
  pending.resolve(harness.page);
  await Promise.all([expect(inFlight).rejects.toThrow("no longer available"), closed]);
  expect(harness.page.closes()).toBe(1);
  expect(unrelated.closes()).toBe(0);
  expect(harness.killed()).toBe(false);
});

test("owned page close uses the recorded target and leaves manual targets and Chrome alone", async () => {
  const harness = workerFor("attached-chrome");
  const worker = harness.worker as typeof harness.worker & {
    readCreatedTargetId(page: unknown): Promise<string | undefined>;
    listOpenPageTargetIds(): Promise<string[] | undefined>;
    closePageTarget(targetId: string): Promise<boolean>;
    openUnownedBrowserKeeper(): Promise<void>;
  };
  const open = new Map<string, boolean>([["manual-tab", true]]);
  const closed: string[] = [];
  let keepers = 0;
  let next = 0;
  worker.readCreatedTargetId = async () => {
    const id = `owned-${++next}`;
    open.set(id, true);
    return id;
  };
  worker.listOpenPageTargetIds = async () => [...open.entries()].filter(([, isOpen]) => isOpen).map(([id]) => id);
  worker.closePageTarget = async targetId => {
    if (targetId === "manual-tab" || !open.has(targetId)) return false;
    closed.push(targetId);
    open.set(targetId, false);
    return true;
  };
  worker.openUnownedBrowserKeeper = async () => {
    keepers += 1;
    open.set(`keeper-${keepers}`, true);
  };

  await harness.worker.run(turn());
  await harness.worker.run(turn({ requireRetainedConversation: true }));
  expect(harness.created()).toBe(1);
  expect(harness.page.closes()).toBe(0);
  await harness.worker.releaseAttachedConversation("lease_test_key");
  await harness.worker.releaseAttachedConversation("lease_test_key");
  expect(closed).toEqual(["owned-1"]);
  expect(harness.page.closes()).toBe(1);
  expect(open.get("manual-tab")).toBe(true);
  expect(keepers).toBe(0);
  expect(harness.killed()).toBe(false);

  const pageA = leasePage();
  const pageB = leasePage();
  const split = workerFor("attached-chrome", pageA);
  const splitWorker = split.worker as typeof worker;
  const splitOpen = new Map<string, boolean>([["manual-tab", true]]);
  const splitClosed: string[] = [];
  let splitNext = 0;
  split.worker.pageForNewTurn = async () => splitNext === 0 ? pageA : pageB;
  splitWorker.readCreatedTargetId = async () => {
    const id = splitNext++ === 0 ? "owner-a" : "owner-b";
    splitOpen.set(id, true);
    return id;
  };
  splitWorker.listOpenPageTargetIds = async () => [...splitOpen.entries()].filter(([, isOpen]) => isOpen).map(([id]) => id);
  splitWorker.closePageTarget = async targetId => {
    if (targetId === "manual-tab") return false;
    splitClosed.push(targetId);
    splitOpen.set(targetId, false);
    return true;
  };
  splitWorker.openUnownedBrowserKeeper = async () => { throw new Error("keeper must not open while another page exists"); };
  await split.worker.run(turn({ conversationKey: "lease_owner_a" }));
  await split.worker.run(turn({ conversationKey: "lease_owner_b" }));
  await split.worker.releaseAttachedConversation("lease_owner_a");
  expect(splitClosed).toEqual(["owner-a"]);
  expect(pageA.closes()).toBe(1);
  expect(pageB.closes()).toBe(0);
  expect(splitOpen.get("manual-tab")).toBe(true);
  expect(splitOpen.get("owner-b")).toBe(true);
  await split.worker.releaseAttachedConversation("lease_owner_b");
  expect(splitClosed).toEqual(["owner-a", "owner-b"]);
  expect(split.killed()).toBe(false);
});

test("a stale closed handle still closes the recorded target, and the last tab keeps Chrome alive", async () => {
  const harness = workerFor("attached-chrome");
  const worker = harness.worker as typeof harness.worker & {
    readCreatedTargetId(page: unknown): Promise<string | undefined>;
    listOpenPageTargetIds(): Promise<string[] | undefined>;
    closePageTarget(targetId: string): Promise<boolean>;
    openUnownedBrowserKeeper(): Promise<void>;
  };
  const open = new Set(["owned-only"]);
  const closed: string[] = [];
  let keepers = 0;
  worker.readCreatedTargetId = async () => "owned-only";
  worker.listOpenPageTargetIds = async () => [...open];
  worker.closePageTarget = async targetId => {
    closed.push(targetId);
    open.delete(targetId);
    return !open.has(targetId);
  };
  worker.openUnownedBrowserKeeper = async () => {
    keepers += 1;
    open.add("keeper");
  };
  await harness.worker.run(turn());
  await harness.page.close();
  await harness.worker.releaseAttachedConversation("lease_test_key");
  await harness.worker.releaseAttachedConversation("lease_test_key");
  expect(closed).toEqual(["owned-only"]);
  expect(keepers).toBe(1);
  expect(open.has("keeper")).toBe(true);
  expect(harness.page.closes()).toBe(1);
  expect(harness.killed()).toBe(false);
});

test("CDP close waits for a delayed target removal and does not close another target", async () => {
  const harness = workerFor("attached-chrome");
  const worker = harness.worker as typeof harness.worker & {
    readCreatedTargetId(page: unknown): Promise<string | undefined>;
    listOpenPageTargetIds(): Promise<string[] | undefined>;
    browser: {
      newBrowserCDPSession?: () => Promise<{
        send(method: string, params?: { targetId?: string }): Promise<unknown>;
        detach(): Promise<void>;
      }>;
    };
  };
  worker.readCreatedTargetId = async () => "owned-1";
  worker.listOpenPageTargetIds = async () => ["manual-tab", "owned-1"];
  let listings = 0;
  const closed: string[] = [];
  let detached = 0;
  worker.browser.newBrowserCDPSession = async () => ({
    send: async (method, params) => {
      if (method === "Target.closeTarget") {
        closed.push(params?.targetId ?? "");
        return { success: true };
      }
      if (method !== "Target.getTargets") throw new Error(`unexpected ${method}`);
      listings += 1;
      return {
        targetInfos: [
          { type: "page", targetId: "manual-tab" },
          ...(listings <= 3 ? [{ type: "page", targetId: "owned-1" }] : []),
        ],
      };
    },
    detach: async () => { detached += 1; },
  });
  await harness.worker.run(turn());
  await harness.worker.releaseAttachedConversation("lease_test_key");
  await harness.worker.releaseAttachedConversation("lease_test_key");
  expect(closed).toEqual(["owned-1"]);
  expect(listings).toBe(4);
  expect(detached).toBe(1);
  expect(harness.page.closes()).toBe(1);
  expect(harness.killed()).toBe(false);

  const absent = workerFor("attached-chrome");
  const absentWorker = absent.worker as typeof worker;
  let absentCloses = 0;
  let absentDetached = 0;
  absentWorker.browser.newBrowserCDPSession = async () => ({
    send: async method => {
      if (method === "Target.closeTarget") {
        absentCloses += 1;
        return { success: true };
      }
      return { targetInfos: [{ type: "page", targetId: "manual-tab" }] };
    },
    detach: async () => { absentDetached += 1; },
  });
  const gone = await (absentWorker as unknown as { closePageTarget(id: string): Promise<boolean> })
    .closePageTarget("owned-1");
  expect(gone).toBe(true);
  expect(absentCloses).toBe(0);
  expect(absentDetached).toBe(1);
});

test("CDP close fails closed when the recorded target remains past the settle deadline", async () => {
  const harness = workerFor("attached-chrome");
  const worker = harness.worker as typeof harness.worker & {
    readCreatedTargetId(page: unknown): Promise<string | undefined>;
    listOpenPageTargetIds(): Promise<string[] | undefined>;
    ownedTargetCloseTiming(): {
      now: () => number;
      sleep: (ms: number) => Promise<void>;
      deadlineMs: number;
      intervalMs: number;
    };
    browser: {
      newBrowserCDPSession?: () => Promise<{
        send(method: string, params?: { targetId?: string }): Promise<unknown>;
        detach(): Promise<void>;
      }>;
    };
  };
  worker.readCreatedTargetId = async () => "owned-stuck";
  worker.listOpenPageTargetIds = async () => ["manual-tab", "owned-stuck"];
  let now = 5_000;
  const closed: string[] = [];
  let listings = 0;
  let detached = 0;
  worker.ownedTargetCloseTiming = () => ({
    now: () => now,
    sleep: async ms => { now += ms; },
    deadlineMs: 1_500,
    intervalMs: 100,
  });
  worker.browser.newBrowserCDPSession = async () => ({
    send: async (method, params) => {
      if (method === "Target.closeTarget") {
        closed.push(params?.targetId ?? "");
        return { success: true };
      }
      if (method !== "Target.getTargets") throw new Error(`unexpected ${method}`);
      listings += 1;
      return {
        targetInfos: [
          { type: "page", targetId: "manual-tab" },
          { type: "page", targetId: "owned-stuck" },
        ],
      };
    },
    detach: async () => { detached += 1; },
  });
  await harness.worker.run(turn());
  let message = "";
  try {
    await harness.worker.releaseAttachedConversation("lease_test_key");
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  expect(message).toBe("Owned Temporary Chat page did not close");
  expect(closed).toEqual(["owned-stuck"]);
  expect(listings).toBeGreaterThan(2);
  expect(now).toBe(6_500);
  expect(detached).toBe(1);
  expect(harness.page.closes()).toBe(1);
  expect(harness.killed()).toBe(false);
});
