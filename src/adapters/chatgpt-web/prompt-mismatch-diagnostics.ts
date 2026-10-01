interface CodePointEvidence { offset: number; value: string }
interface PromptContext {
  start: number;
  end: number;
  chars: number;
  escapedText: string;
  codeUnits: Array<string | null>;
  codePoints: CodePointEvidence[];
  containsNbsp: boolean;
}
interface DifferenceEvidence {
  offset: number;
  expectedCodeUnit: string | null;
  actualCodeUnit: string | null;
  expectedCodePoint: CodePointEvidence | null;
  actualCodePoint: CodePointEvidence | null;
}
interface LineBoundaries { previous: number | null; next: number | null }
export interface PromptMismatchDomStructure {
  snapshotChars: number;
  trimmedLeadingChars: number;
  topLevelChildCount: number;
  targetTopLevelIndex: number | null;
  nodes: Array<{ path: number[]; nodeType: number; tag: string | null; start: number; end: number; textChars: number; childCount: number }>;
  nodeLimit: number;
  depthLimit: number;
  truncated: boolean;
}
export interface PromptMismatchDiagnostic {
  expectedChars: number;
  actualChars: number;
  rawCommonPrefixChars: number;
  equivalentCommonPrefixChars: number;
  rawCommonSuffixChars: number;
  suffixRealignment: { expectedOffset: number; actualOffset: number; offsetDelta: number } | null;
  firstDifference: DifferenceEvidence;
  firstUnequivalentDifference: DifferenceEvidence;
  expectedContext: PromptContext;
  actualContext: PromptContext;
  expectedFailureContext?: PromptContext;
  actualFailureContext?: PromptContext;
  expectedLineBoundaries: LineBoundaries;
  actualLineBoundaries: LineBoundaries;
  dom?: PromptMismatchDomStructure & { matchesLastReadback: boolean };
  domCaptureFailed?: true;
}

// Failure-only evidence. Never return whole prompts, HTML, attributes, or editor text in DOM metadata.
export function describePromptMismatch(expected: string, actual: string, equivalentPrefix: number): PromptMismatchDiagnostic {
  let rawPrefix = 0;
  while (rawPrefix < Math.min(expected.length, actual.length) && expected[rawPrefix] === actual[rawPrefix]) rawPrefix++;
  let rawSuffix = 0;
  while (rawSuffix < Math.min(expected.length, actual.length) - rawPrefix
    && expected[expected.length - rawSuffix - 1] === actual[actual.length - rawSuffix - 1]) rawSuffix++;

  const unit = (text: string, offset: number) => offset < text.length
    ? `0x${text.charCodeAt(offset).toString(16).padStart(4, "0")}` : null;
  const point = (text: string, offset: number) => {
    if (offset >= text.length) return null;
    const low = text.charCodeAt(offset);
    const high = text.charCodeAt(offset - 1);
    const start = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? offset - 1 : offset;
    return { offset: start, value: `U+${text.codePointAt(start)!.toString(16).toUpperCase().padStart(4, "0")}` };
  };
  const context = (text: string, offset: number) => {
    let start = Math.max(0, offset - 32);
    let end = Math.min(text.length, offset + 32);
    // Even a short input must not be persisted verbatim in its entirety.
    if (start === 0 && end === text.length) {
      if (offset > 0) start = 1;
      else end = Math.max(0, end - 1);
    }
    // Shrink inward rather than fabricate unpaired code points from clipped valid pairs.
    if (text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff
      && text.charCodeAt(start - 1) >= 0xd800 && text.charCodeAt(start - 1) <= 0xdbff) start++;
    if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
      && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
    end = Math.max(start, end);
    const slice = text.slice(start, end);
    const codeUnits = Array.from({ length: slice.length }, (_, index) => unit(slice, index));
    const codePoints: Array<{ offset: number; value: string }> = [];
    for (let index = 0; index < slice.length;) {
      const value = slice.codePointAt(index)!;
      codePoints.push({ offset: start + index, value: `U+${value.toString(16).toUpperCase().padStart(4, "0")}` });
      index += value > 0xffff ? 2 : 1;
    }
    return {
      start, end, chars: slice.length,
      escapedText: JSON.stringify(slice).slice(1, -1).replace(/[\u007f-\u009f\u00a0\u2028\u2029]/g,
        character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`),
      codeUnits, codePoints, containsNbsp: slice.includes("\u00a0"),
    };
  };
  const boundaries = (text: string, offset: number) => {
    let previous: number | null = null;
    let next: number | null = null;
    for (let index = Math.min(offset - 1, text.length - 1); index >= 0; index--) {
      if (text[index] === "\n" || text[index] === "\r") { previous = index; break; }
    }
    for (let index = offset; index < text.length; index++) {
      if (text[index] === "\n" || text[index] === "\r") { next = index; break; }
    }
    return { previous, next };
  };
  return {
    expectedChars: expected.length, actualChars: actual.length,
    rawCommonPrefixChars: rawPrefix, equivalentCommonPrefixChars: equivalentPrefix,
    rawCommonSuffixChars: rawSuffix,
    suffixRealignment: rawSuffix > 0 ? {
      expectedOffset: expected.length - rawSuffix, actualOffset: actual.length - rawSuffix,
      offsetDelta: actual.length - expected.length,
    } : null,
    firstDifference: {
      offset: rawPrefix, expectedCodeUnit: unit(expected, rawPrefix), actualCodeUnit: unit(actual, rawPrefix),
      expectedCodePoint: point(expected, rawPrefix), actualCodePoint: point(actual, rawPrefix),
    },
    expectedContext: context(expected, rawPrefix), actualContext: context(actual, rawPrefix),
    ...(rawPrefix !== equivalentPrefix ? {
      expectedFailureContext: context(expected, equivalentPrefix), actualFailureContext: context(actual, equivalentPrefix),
    } : {}),
    firstUnequivalentDifference: {
      offset: equivalentPrefix, expectedCodeUnit: unit(expected, equivalentPrefix), actualCodeUnit: unit(actual, equivalentPrefix),
      expectedCodePoint: point(expected, equivalentPrefix), actualCodePoint: point(actual, equivalentPrefix),
    },
    expectedLineBoundaries: boundaries(expected, equivalentPrefix), actualLineBoundaries: boundaries(actual, equivalentPrefix),
  };
}

/** Executed in the composer document. The text is transient, only used to check snapshot alignment. */
export function snapshotPromptMismatchDom(element: HTMLElement, offset: number): { text: string; structure: PromptMismatchDomStructure } {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    '[data-id^="plugin:"][data-keyword], [data-inline-selection-pill-cursor-target], [app-mention-path^="app://"][app-mention-display-name][contenteditable="false"]',
  ).forEach(part => part.remove());
  const children = Array.from(clone.childNodes);
  const joined = children.map(child => child.textContent ?? "").join("\n");
  const text = joined.trimStart();
  const trimmedLeadingChars = joined.length - text.length;
  const rows: Array<{ path: number[]; nodeType: number; tag: string | null; start: number; end: number; textChars: number; childCount: number }> = [];
  let totalRows = 0;
  let topOffset = -trimmedLeadingChars;
  const topLevels = children.map((child, index) => {
    const start = topOffset;
    topOffset += (child.textContent ?? "").length + 1;
    return { child, index, start, end: topOffset - 1 };
  });
  const target = topLevels.findIndex(row => offset <= row.end);
  const center = target < 0 ? Math.max(0, topLevels.length - 1) : target;
  const visit = (node: Node, path: number[], start: number) => {
    const length = (node.textContent ?? "").length;
    totalRows++;
    if (rows.length < 24) rows.push({
      path, nodeType: node.nodeType, tag: node instanceof Element ? node.tagName : null,
      start, end: start + length, textChars: length, childCount: node.childNodes.length,
    });
    if (path.length >= 12 || rows.length >= 24) return;
    let childOffset = start;
    Array.from(node.childNodes).forEach((child, index) => {
      const childLength = (child.textContent ?? "").length;
      if (childOffset <= offset + 32 && childOffset + childLength >= offset - 32) visit(child, [...path, index], childOffset);
      childOffset += childLength;
    });
  };
  for (const row of topLevels.slice(Math.max(0, center - 2), center + 3)) visit(row.child, [row.index], row.start);
  return { text, structure: {
    snapshotChars: text.length, trimmedLeadingChars, topLevelChildCount: children.length,
    targetTopLevelIndex: target < 0 ? null : target,
    nodes: rows, nodeLimit: 24, depthLimit: 12, truncated: totalRows > rows.length || rows.length >= 24 || rows.some(row => row.path.length >= 12 && row.childCount > 0),
  } };
}

export type PromptDiagnosticCapture = (checkpoint: string, mismatch?: PromptMismatchDiagnostic) => Promise<void>;
