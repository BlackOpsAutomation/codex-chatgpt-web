import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  connectAttachedChrome,
  isChatGptPageUrl,
  pageForAttachedChrome,
  selectAttachedChatGptPage,
} from "../src/attached-chrome-host";
import { assertLoopbackBrowserAttachEndpoint, defaultConfig, loadConfig } from "../src/config";
import { ChatGptBrowserWorker, resolveBrowserConfig } from "../src/adapters/chatgpt-web/browser-worker";

const roots: string[] = [];
const AUTHENTICATED_PROFILE = "/home/wintersun/.chatgpt-omp/browser/profile";

afterEach(() => {
  delete process.env.CODEX_CHATGPT_WEB_HOME;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeConfig(config: Record<string, unknown>): void {
  const root = mkdtempSync(join(tmpdir(), "codex-attached-chrome-config-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  writeFileSync(join(root, "config.json"), `${JSON.stringify(config)}\n`);
}

function attachedConfig(endpoint?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...defaultConfig("browser-only"),
    browserHost: "attached-chrome",
    controlToken: "attached-chrome-control-token-0123456789abcdef",
    runtimeCommand: [process.execPath],
  };
  delete config.storageStatePath;
  if (endpoint !== undefined) config.browserAttachEndpoint = endpoint;
  return config;
}

test("attached-chrome accepts an explicit loopback endpoint without storage-state files", () => {
  writeConfig(attachedConfig("http://127.0.0.1:9222"));
  const loaded = loadConfig();
  expect(loaded.browserHost).toBe("attached-chrome");
  expect(loaded.browserAttachEndpoint).toBe("http://127.0.0.1:9222");
  expect(loaded.storageStatePath).toBe("");
  expect(existsSync(join(process.env.CODEX_CHATGPT_WEB_HOME!, "browser", "storage-state.json"))).toBe(false);
  expect(existsSync(`${loaded.storageStatePath}.verified.json`)).toBe(false);
});

test("attached-chrome accepts localhost and IPv6 loopback endpoints", () => {
  expect(assertLoopbackBrowserAttachEndpoint("http://localhost:9333")).toBe("http://localhost:9333");
  expect(assertLoopbackBrowserAttachEndpoint("http://[::1]:9334")).toBe("http://[::1]:9334");
});

test("attached-chrome rejects a missing or non-loopback endpoint", () => {
  writeConfig(attachedConfig());
  expect(() => loadConfig()).toThrow("requires browserAttachEndpoint");
  for (const endpoint of [
    "http://8.8.8.8:9222",
    "http://0.0.0.0:9222",
    "https://127.0.0.1:9222",
    "http://127.0.0.1",
    "http://user:secret@127.0.0.1:9222",
    "ws://127.0.0.1:9222/devtools/browser/token",
  ]) {
    expect(() => assertLoopbackBrowserAttachEndpoint(endpoint)).toThrow("browserAttachEndpoint");
  }
  writeConfig({ ...defaultConfig("browser-only"), browserAttachEndpoint: "http://127.0.0.1:9222" });
  expect(() => loadConfig()).toThrow("only valid for attached-chrome");
});

test("attached config does not require storage-state files to resolve a worker", () => {
  const resolved = resolveBrowserConfig({
    adapter: "chatgpt-web",
    baseUrl: "https://chatgpt.com",
    models: ["gpt-5.6-sol"],
    chatgptWeb: {
      appName: "Codex Native2",
      browserHost: "attached-chrome",
      browserAttachEndpoint: "http://127.0.0.1:9222",
    },
  });
  expect(resolved.browserHost).toBe("attached-chrome");
  expect(resolved.browserAttachEndpoint).toBe("http://127.0.0.1:9222");
  expect(resolved.storageStatePath).toBe("");
  expect(existsSync(resolved.storageStatePath)).toBe(false);
});

test("page selection prefers an existing ChatGPT page and ignores unrelated pages", () => {
  const unrelated = { url: () => "https://example.com/inbox" };
  const internal = { url: () => "chrome://newtab/" };
  const chatgpt = { url: () => "https://chatgpt.com/c/existing" };
  expect(isChatGptPageUrl("https://chatgpt.com/")).toBe(true);
  expect(isChatGptPageUrl("https://www.chatgpt.com/")).toBe(true);
  expect(isChatGptPageUrl("https://chatgpt.com.evil.example/")).toBe(false);
  expect(isChatGptPageUrl("http://chatgpt.com/")).toBe(false);
  const selected = selectAttachedChatGptPage([
    { pages: () => [unrelated, internal] },
    { pages: () => [chatgpt] },
  ]);
  expect(selected?.contextIndex).toBe(1);
  expect(selected?.page).toBe(chatgpt);
  expect(selectAttachedChatGptPage([{ pages: () => [unrelated, internal] }])).toBeUndefined();
});

test("attached turns use the existing context and managed Chrome still requires login files", async () => {
  let createdContext = false;
  const context = {
    newPage: async () => ({ url: () => "about:blank" }),
    newContext: () => {
      createdContext = true;
      throw new Error("attached mode created a storage-state context");
    },
  };
  const attached = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: {
      browserHost: "attached-chrome",
      browserAttachEndpoint: "http://127.0.0.1:9",
      storageStatePath: join(tmpdir(), "missing-attached-storage-state.json"),
    },
    ensureAttachedContext: async () => ({ context }),
  }) as { pageForNewTurn(): Promise<{ url(): string }> };
  expect((await attached.pageForNewTurn()).url()).toBe("about:blank");
  expect(createdContext).toBe(false);

  const managed = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: {
      browserHost: "managed-chrome",
      storageStatePath: join(tmpdir(), "missing-managed-storage-state.json"),
      chromeExecutablePath: process.execPath,
    },
  }) as { ensureManagedBrowser(): Promise<unknown> };
  await expect(managed.ensureManagedBrowser()).rejects.toThrow("login state is missing");
});

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function disposableChromeExecutable(): string {
  const candidates = [
    process.env.GOOGLE_CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/home/wintersun/.local/opt/chrome-root/opt/google/chrome/chrome",
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error("No disposable Chrome executable is available for the CDP smoke test");
  return found;
}

function profilePids(profile: string): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = readFileSync(join("/proc", entry, "cmdline")).toString("utf8").replaceAll("\0", " ");
      if (command.includes(profile) && command.includes("chrome")) pids.push(Number(entry));
    } catch {
      // The process can exit between listing and reading.
    }
  }
  return pids;
}

test("disposable Chrome survives attached CDP disconnect and does not use the authenticated profile", async () => {
  const profile = mkdtempSync(join(tmpdir(), "codex-attached-chrome-profile-"));
  roots.push(profile);
  expect(profile).not.toBe(AUTHENTICATED_PROFILE);
  expect(profile.includes("/.chatgpt-omp/browser/profile")).toBe(false);
  const port = await freeLoopbackPort();
  const chrome = disposableChromeExecutable();
  const child = spawn(chrome, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ":99" },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    // Chrome process startup is an external clock. Fake timers cannot open its debugging port.
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
      try {
        ready = (await fetch(`${endpoint}/json/version`)).ok;
      } catch {
        ready = false;
      }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(ready).toBe(true);
    const listeners = Bun.spawnSync({ cmd: ["ss", "-ltn"], stdout: "pipe" }).stdout.toString();
    const portLines = listeners.split("\n").filter(line => line.includes(`:${port}`));
    const localAddresses = portLines.map(line => line.trim().split(/\s+/)[3] ?? "");
    expect(localAddresses.length).toBeGreaterThan(0);
    expect(localAddresses.every(address => address.startsWith("127.0.0.1:") || address.startsWith("[::1]:"))).toBe(true);

    const connection = await connectAttachedChrome(endpoint);
    expect(connection.browser.contexts()).toHaveLength(1);
    expect(connection.browser.contexts()[0]).toBe(connection.context);
    const opened = await pageForAttachedChrome(connection.browser);
    expect(opened.created).toBe(true);
    expect(opened.context).toBe(connection.context);
    await opened.page.goto(`data:text/html,${encodeURIComponent("<title>attached-chrome-smoke</title>")}`);
    expect(connection.browser.contexts()).toHaveLength(1);
    await connection.browser.close();

    expect((await fetch(`${endpoint}/json/version`)).ok).toBe(true);
    const reconnected = await chromium.connectOverCDP(endpoint);
    const titles = await Promise.all(reconnected.contexts()[0].pages().map(page => page.title()));
    expect(titles).toContain("attached-chrome-smoke");
    await reconnected.close();
    expect((await fetch(`${endpoint}/json/version`)).ok).toBe(true);
    expect(existsSync(join(profile, "storage-state.json"))).toBe(false);
    expect(existsSync(join(profile, "storage-state.json.verified.json"))).toBe(false);
  } finally {
    for (const pid of profilePids(profile)) {
      if (pid === 2162681) continue;
      try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
    }
  }
}, 60_000);
