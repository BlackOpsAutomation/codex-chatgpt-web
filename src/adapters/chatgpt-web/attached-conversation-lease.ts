/**
 * Identity rules for an attached-Chrome page this process created.
 * The worker owns the Page. This module does not select an existing tab,
 * connect to CDP, or close Chrome.
 */

export const ATTACHED_CONVERSATION_LEASE_KEY = /^[A-Za-z0-9_-]{8,128}$/;
export const ATTACHED_LEASE_MARKER_PROPERTY = "__codexAttachedConversationLease";

export interface OwnedPageClosePlan {
  /** CDP target to close. Absent means do not close any target. */
  closeTargetId?: string;
  /** Owned target is the browser's only page; open an unowned keeper before closing it. */
  keepBrowserAlive: boolean;
}

/**
 * Decide whether a final lease release may close a page.
 * Ownership is the recorded target, never a URL or a tab count.
 * An uncertain or shared target stays open. This does not close Chrome.
 */
export function planOwnedPageClose(input: {
  owned?: { targetId?: string; createdByBridge?: boolean; ownerKey: string };
  openTargetIds: readonly string[];
  leasesUsingTarget: readonly string[];
}): OwnedPageClosePlan {
  const owned = input.owned;
  if (owned?.createdByBridge !== true || !owned.targetId) return { keepBrowserAlive: false };
  if (!input.openTargetIds.includes(owned.targetId)) return { keepBrowserAlive: false };
  if (input.leasesUsingTarget.some(key => key !== owned.ownerKey)) return { keepBrowserAlive: false };
  return {
    closeTargetId: owned.targetId,
    keepBrowserAlive: input.openTargetIds.every(id => id === owned.targetId),
  };
}

/** Bind the observed conversation route, including Temporary Chat when it has no /c/<id>. */
export function attachedConversationIdentity(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://chatgpt.com") return undefined;
    if (/^\/c\/[A-Za-z0-9_-]{8,128}\/?$/.test(parsed.pathname)) {
      return `${parsed.origin}${parsed.pathname}`;
    }
    if (parsed.pathname === "/" && parsed.searchParams.get("temporary-chat") === "true") {
      return `${parsed.origin}/?temporary-chat=true`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Select the newest mounted user identity, or verify an exact previously trusted anchor. */
export async function readAttachedConversationAnchor(
  page: AttachedLeasePage,
  userTurnSelector: string,
  expected?: string,
  advance = false,
): Promise<string | undefined> {
  if (page.isClosed()) return undefined;
  try {
    return await page.evaluate((input: unknown) => {
      const { userTurnSelector, expected, advance } = input as { userTurnSelector: string; expected?: string; advance: boolean };
      const groups = [...document.querySelectorAll("[data-turn-key]")];
      const containers = [...document.querySelectorAll("[data-turn-id-container]")].filter(element =>
        !element.closest("[data-turn-key]")
        && element.parentElement?.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container")
          !== element.getAttribute("data-turn-id-container"));
      const outer = [
        ...groups.map(element => `group:${element.getAttribute("data-turn-key") ?? ""}`),
        ...containers.map(element => `turn:${element.getAttribute("data-turn-id-container") ?? ""}`),
      ];
      if (outer.some(anchor => anchor.endsWith(":")) || new Set(outer).size !== outer.length) return undefined;
      if (expected) {
        if (outer.filter(anchor => anchor === expected).length !== 1) return undefined;
        if (!advance) return expected;
      }

      const group = groups.findLast(element => element.querySelector("[data-user-message-bubble]"));
      if (group) return `group:${group.getAttribute("data-turn-key")}`;
      const users = [...document.querySelectorAll(userTurnSelector)];
      const userIdentities = new Set(users.map(element => element.getAttribute("data-turn-id")));
      const container = containers.findLast(element => userIdentities.has(element.getAttribute("data-turn-id-container")));
      return container ? `turn:${container.getAttribute("data-turn-id-container")}` : undefined;
    }, { userTurnSelector, expected, advance });
  } catch {
    return undefined;
  }
}

export function attachedConversationLeaseRequested(
  browserHost: string,
  turn: {
    conversationKey?: string;
    retainConversation?: boolean;
    requireRetainedConversation?: boolean;
  },
): boolean {
  return browserHost === "attached-chrome"
    && typeof turn.conversationKey === "string"
    && ATTACHED_CONVERSATION_LEASE_KEY.test(turn.conversationKey)
    && (turn.retainConversation === true || turn.requireRetainedConversation === true);
}

export function attachedLeaseMarker(conversationKey: string): string {
  return `attached-lease:${conversationKey}`;
}

export interface AttachedLeasePage {
  isClosed(): boolean;
  evaluate<T>(pageFunction: (arg: unknown) => T | Promise<T>, arg: unknown): Promise<T>;
}

export async function stampAttachedLeaseMarker(page: AttachedLeasePage, marker: string): Promise<void> {
  await page.evaluate((input: unknown) => {
    const stamp = input as { property: string; value: string };
    Object.defineProperty(globalThis, stamp.property, {
      configurable: true,
      value: stamp.value,
    });
  }, { property: ATTACHED_LEASE_MARKER_PROPERTY, value: marker });
}

export async function readAttachedLeaseMarker(page: AttachedLeasePage): Promise<string | undefined> {
  if (page.isClosed()) return undefined;
  try {
    const value = await page.evaluate((property: unknown) => {
      const marker = (globalThis as Record<string, unknown>)[String(property)];
      return typeof marker === "string" ? marker : undefined;
    }, ATTACHED_LEASE_MARKER_PROPERTY);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
