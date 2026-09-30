import { activateChatGptEffortMenu, parseChatGptEffortSliderState } from "../../chatgpt-session";
import { CHATGPT_WEB_LUNA_MODEL_ID, CHATGPT_WEB_MODEL_ID } from "./model";
import type { ChatGptWebAdapterEffort, ChatGptWebModelFamily } from "../../chatgpt-web-models";
import type { ChatGptEffortSliderState } from "../../chatgpt-session";
import { ChatGptWebAdapterError } from "./adapter-error";

type EffortMenu = Awaited<ReturnType<typeof activateChatGptEffortMenu>>;
export type ChatGptRequestedModel =
  | "gpt-5.6-luna" | "gpt-5.6-sol" | "gpt-5.6-terra"
  | "gpt-6-luna" | "gpt-6-sol" | "gpt-6-terra"
  | "gpt-6.1-luna" | "gpt-6.1-sol" | "gpt-6.1-terra";
type RequestedReasoning = "none" | "low" | "medium" | "high" | "xhigh";
interface RequestedModelRegistration {
  backendModelId?: string;
  selectorContract: "exact-gpt-5.6-sol" | undefined;
  reasoning: Partial<Record<RequestedReasoning, ChatGptWebAdapterEffort>>;
}
const requestedModelRegistry: Record<ChatGptRequestedModel, RequestedModelRegistration> = {
  "gpt-5.6-luna": {
    backendModelId: CHATGPT_WEB_LUNA_MODEL_ID,
    selectorContract: undefined,
    reasoning: { none: "low", low: "low", medium: "medium" },
  },
  "gpt-5.6-sol": {
    backendModelId: CHATGPT_WEB_MODEL_ID,
    selectorContract: "exact-gpt-5.6-sol",
    reasoning: { none: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
  },
  "gpt-5.6-terra": { selectorContract: undefined, reasoning: {} },
  "gpt-6-luna": { selectorContract: undefined, reasoning: {} },
  "gpt-6-sol": { selectorContract: undefined, reasoning: {} },
  "gpt-6-terra": { selectorContract: undefined, reasoning: {} },
  "gpt-6.1-luna": { selectorContract: undefined, reasoning: {} },
  "gpt-6.1-sol": { selectorContract: undefined, reasoning: {} },
  "gpt-6.1-terra": { selectorContract: undefined, reasoning: {} },
};

export function requestedModelUnavailable(model: string, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `Requested ChatGPT model ${model} is not available in the verified browser controls. The pending message was not sent.`,
    { status: 400, errorType: "invalid_request_error", code: "model_not_available", retryable: false, cause },
  );
}

export function requestedReasoningUnavailable(effort: string, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `Requested ChatGPT reasoning level ${effort} is not available in the verified browser controls. The pending message was not sent.`,
    { status: 400, errorType: "invalid_request_error", code: "reasoning_not_available", retryable: false, cause },
  );
}
export function assertRequestedEffortAvailable(
  state: ChatGptEffortSliderState & { available: boolean[]; disabled: boolean },
  effortIndex: number,
  effort: string,
): void {
  if (state.disabled || effortIndex > state.max - state.min || !state.available[effortIndex]) {
    throw requestedReasoningUnavailable(effort);
  }
}

export interface RequestedChatGptMode {
  backendModelId: string;
  family: "5.6";
  effort: ChatGptWebAdapterEffort;
}

export function resolveRequestedChatGptMode(
  model: string,
  reasoning: string | undefined,
): RequestedChatGptMode {
  const registered = requestedModelRegistry[model as ChatGptRequestedModel];
  if (!registered?.backendModelId || registered.selectorContract !== "exact-gpt-5.6-sol") {
    throw requestedModelUnavailable(model);
  }
  const requestedReasoning = reasoning ?? "none";
  const effort = registered.reasoning[requestedReasoning as RequestedReasoning];
  if (!effort) throw requestedReasoningUnavailable(requestedReasoning);
  return { backendModelId: registered.backendModelId, family: "5.6", effort };
}

function familyError(family: ChatGptWebModelFamily, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `ChatGPT model ${family} could not be selected and verified. The pending message was not sent. Check the model in the browser; if ChatGPT uses an unsupported language, select English in Settings → General → Language and reload it.`,
    { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false, cause },
  );
}

function familyOption(menu: EffortMenu, family: ChatGptWebModelFamily, exactSolOnly = false) {
  return menu.menu.getByRole("menuitemradio", {
    name: family === "5.6" ? exactSolOnly ? /^GPT[-\s]?5\.6\s+Sol$/i
      : /^GPT[-\s]?5\.6\s+Sol(?:\s+Pro)?$/i
      // Simplified/Traditional Chinese and Japanese share 最新; Korean uses 최신.
      : /^(?:Latest|最新|최신|GPT[-\s]?6(?:\s+Astra)?(?:\s+Pro)?)$/i,
    exact: true,
    includeHidden: true,
  });
}

/** Model and effort are separate browser controls; a generic Pro label proves neither family. */
export async function selectChatGptModelFamily(
  menu: EffortMenu,
  family: ChatGptWebModelFamily,
  activate: () => Promise<EffortMenu>,
  exactSolOnly = false,
): Promise<EffortMenu> {
  try {
    const option = familyOption(menu, family, exactSolOnly);
    if (await option.count() > 1) throw familyError(family);
    if (await option.count() === 1 && await option.getAttribute("aria-checked") === "true") return menu;
    // The attached radio rows are inert while this composer-owned advanced view is collapsed.
    const powerView = menu.menu.locator('[data-model-picker-view]');
    if (await powerView.count() === 1) {
      const view = await powerView.getAttribute("data-model-picker-view");
      if (view === "simple") {
        const trigger = powerView.locator('[data-model-picker-view-toggle="true"][aria-hidden="false"]');
        if (await trigger.count() !== 1) throw familyError(family);
        await trigger.click({ timeout: 5_000 });
      } else if (view !== "advanced") throw familyError(family);
    } else {
      const trigger = menu.menu.locator('[role="menuitem"][aria-expanded][aria-hidden="false"]');
      if (await powerView.count() !== 0 || await trigger.count() !== 1) throw familyError(family);
      if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click({ timeout: 5_000 });
    }
    await option.waitFor({ state: "visible", timeout: 5_000 });
    await option.click({ timeout: 5_000 });
    // Choosing a family returns the open picker to its slider. Keep that surface:
    // Escape followed by an immediate reopen races the outgoing menu's cleanup.
    // Activation reuses the open menu and verifies its owner before returning it.
    const selected = await activate();
    const deadline = Date.now() + 1_000;
    do {
      const current = familyOption(selected, family, exactSolOnly);
      if (await current.count() > 1) throw familyError(family);
      if (await current.count() === 1 && await current.getAttribute("aria-checked") === "true") return selected;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw familyError(family);
  } catch (cause) {
    if (cause instanceof ChatGptWebAdapterError) throw cause;
    throw familyError(family, cause);
  }
}

interface ModelDescriptionState {
  version: string;
  name?: string;
  mode: string;
}

function modelDescriptionStates(descriptions: readonly string[]): ModelDescriptionState[] {
  return descriptions.flatMap(text => {
    const match = /^(?:GPT[-\s]?)?(\d+(?:\.\d+)?)(?:\s+(Sol|Astra))?\s+([^,，]+)(?:[,，]|$)/i
      .exec(text.replace(/\s+/g, " ").trim());
    return match ? [{ version: match[1]!, name: match[2]?.toLowerCase(), mode: match[3]!.trim() }] : [];
  });
}

function requestedEffortLabel(effort: ChatGptWebAdapterEffort): string {
  return { low: "Instant", medium: "Medium", high: "High", xhigh: "Extra High", max: "Pro" }[effort];
}

function modelDescriptionEffortMatches(
  descriptions: readonly string[],
  effort: ChatGptWebAdapterEffort,
): boolean {
  const states = modelDescriptionStates(descriptions);
  return states.length > 0 && states.every(state => state.mode.toLowerCase() === requestedEffortLabel(effort).toLowerCase());
}

export function chatGptModelFamilyMatches(
  descriptions: readonly string[],
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
): boolean {
  // Latest uses 5.6 for the existing lower-effort multipart acknowledgements and 6 for Pro.
  // Never interpret a future Latest Pro model as 6, or a lower effort as the final Pro response.
  const expected = family === "6" && effort !== "max" ? "5.6" : family;
  const states = modelDescriptionStates(descriptions);
  return states.length > 0 && states.every(state => state.version === expected
    && (!state.name || state.name === (expected === "5.6" ? "sol" : "astra"))
    && (effort === "max" ? /^Pro$/i.test(state.mode) : !/^Pro$/i.test(state.mode)));
}

/** The power picker can omit the version from its announcement while its checked
 * radio still names the family. Accept that surface only for an explicit Sol row
 * and the exact non-Pro effort announced by the same slider's owner.
 */
async function versionlessSolEffortLabel(
  menu: EffortMenu,
  effortIndex: number,
  optionCount: number,
  descriptions: readonly string[],
): Promise<string | undefined> {
  const match = /^(Instant|Medium|High|Extra High), (\d+) of (\d+)\.$/i.exec(descriptions[0]?.trim() ?? "");
  if (!match || Number(match[2]) !== effortIndex + 1 || Number(match[3]) !== optionCount
    || descriptions.slice(1).some(text => /\b(?:GPT[-\s]?)?\d+(?:\.\d+)?\b|\bPro\b/i.test(text))) return undefined;
  const sol = menu.menu.getByRole("menuitemradio", {
    name: /^GPT[-\s]?5\.6\s+Sol$/i, exact: true, includeHidden: true,
  });
  if (await sol.count() !== 1 || await sol.getAttribute("aria-checked") !== "true") return undefined;
  return match[1]!.toLowerCase() === "extra high" ? "Extra High" : match[1]![0]!.toUpperCase() + match[1]!.slice(1).toLowerCase();
}

async function versionlessSolEffortMatches(
  menu: EffortMenu,
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
  effortIndex: number,
  optionCount: number,
  descriptions: readonly string[],
): Promise<boolean> {
  return family === "5.6" && effort !== "max"
    && await versionlessSolEffortLabel(menu, effortIndex, optionCount, descriptions) === requestedEffortLabel(effort);
}

export async function assertChatGptModelFamily(
  menu: EffortMenu,
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
  effortIndex: number,
  settleMs = 0,
  requireExactEffort = false,
): Promise<void> {
  const deadline = Date.now() + settleMs;
  do {
    const option = familyOption(menu, family, requireExactEffort);
    const checked = await option.count() === 1 && await option.getAttribute("aria-checked") === "true";
    const state = parseChatGptEffortSliderState(
      await menu.slider.getAttribute("aria-valuemin"), await menu.slider.getAttribute("aria-valuemax"),
      await menu.slider.getAttribute("aria-valuenow"),
    );
    const descriptions = await menu.slider.locator("xpath=ancestor::*[@role='menuitem'][1]").evaluate(element => (
      (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
        .map(id => element.ownerDocument.getElementById(id)?.textContent ?? "")
    ));
    const familyMatches = chatGptModelFamilyMatches(descriptions, family, effort);
    const versionlessLabel = requireExactEffort && family === "5.6"
      ? await versionlessSolEffortLabel(menu, effortIndex, state ? state.max - state.min + 1 : 0, descriptions)
      : undefined;
    const versionlessMatches = !requireExactEffort && await versionlessSolEffortMatches(
      menu, family, effort, effortIndex, state ? state.max - state.min + 1 : 0, descriptions,
    );
    if (checked && state && state.value === state.min + effortIndex
      && (familyMatches || versionlessMatches || versionlessLabel !== undefined)) {
      if (requireExactEffort
        && !modelDescriptionEffortMatches(descriptions, effort)
        && versionlessLabel !== requestedEffortLabel(effort)) {
        throw requestedReasoningUnavailable(effort);
      }
      return;
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (true);
  throw familyError(family);
}
