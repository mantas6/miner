// The guard that keeps the harness allowlist honest (AGENTS.md: every player
// action needs a harness path).
//
// It reads the source of every component under `src/ui/`, finds each interactive
// JSX element — a `button`, `input`, `select`, `textarea` or `a`, or anything with
// an `onClick`/`onPointerDown` — and checks the element can be reached through
// `agent/targets.ts`: by a literal id on the allowlist, or by an attribute some
// allowlisted target addresses. Anything else must be listed below with the reason
// the agent does not need it. A new button with no harness path fails here, not in
// a play session.
//
// The scan is a small tokenizer, not a TypeScript parse: good enough for JSX
// opening tags and their attributes, which is all it looks at.

import { describe, expect, it } from 'vitest';
import { decorIdSchema } from '../../shared/world-schema';
import { DECOR_IDS } from '../core/inventory';
import { allSlotButtonIds } from '../ui/inventory-slot-ids';
import { addressedAttributes, ATTR_TARGETS, FLAG_ATTR_TARGETS, ID_TARGETS, KIND_TARGETS } from '../../agent/targets';

/** Every component source, keyed by its path relative to this file. */
const SOURCES = import.meta.glob<string>(['../ui/**/*.tsx', '!../ui/**/*.test.tsx'], {query: '?raw', import: 'default', eager: true});

const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a']);
const INTERACTIVE_HANDLERS = new Set(['onClick', 'onPointerDown']);

/**
 * Literal ids on interactive elements the agent is deliberately not given, and why.
 */
const EXCLUDED_IDS: Readonly<Record<string, string>> = {
  intro: 'The whole title card starts the run on a press; start_run (Enter) and introStartBtn cover it.',
  exportSaveText: 'Read-only copy box; its text is already in the info overlay as saveExport.',
  importSaveFileInput: 'Opens the native file chooser, which no page click can answer; pasting into importSaveText is the same import.'
};

/**
 * Dynamic `id={…}` expressions, by file, whose element is reached another way.
 * Each must still be addressed by an allowlisted attribute, or carry a reason.
 */
const DYNAMIC_IDS: Readonly<Record<string, string>> = {
  'InfoScreen.tsx:section.tabId': 'The Info tabs, clicked by data-info-section.',
  'InventoryPanel.tsx:placeable.buttonId': 'Slot ids from inventory-slot-ids.ts; allSlotButtonIds() feeds ID_TARGETS (checked below).',
  'InventoryPanel.tsx:usable.buttonId': 'Slot ids from inventory-slot-ids.ts; allSlotButtonIds() feeds ID_TARGETS (checked below).',
  'ModalShell.tsx:id': 'The dialog itself: a press on its dimmed backdrop only closes it, which Escape and each card\'s close button already do.',
  'ModalShell.tsx:closeId': 'CardHeader\'s close button; every closeId="…" passed to it is checked against ID_TARGETS below.'
};

/** `data-*` attributes on interactive elements that are not how the harness addresses them. */
const EXCLUDED_ATTRS: Readonly<Record<string, string>> = {};

interface JsxAttribute {
  name: string;
  /** The literal string value, when the attribute is `name="…"`. */
  literal?: string;
  /** The expression source, when the attribute is `name={…}`. */
  expression?: string;
}

interface JsxElement {
  file: string;
  tag: string;
  line: number;
  attributes: JsxAttribute[];
}

/** Skip a balanced `{…}` starting at `start`, honouring strings and template literals. */
function skipBraces(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === '\'' || char === '`') {
      i = skipString(source, i);
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

function skipString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === quote) return i;
  }
  return source.length;
}

/** Every JSX-looking opening tag in a file, with its top-level attributes. */
function openingTags(file: string, source: string): JsxElement[] {
  const elements: JsxElement[] = [];
  const tagStart = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  for (let match = tagStart.exec(source); match; match = tagStart.exec(source)) {
    const attributes: JsxAttribute[] = [];
    let i = match.index + match[0].length;
    while (i < source.length) {
      const char = source[i];
      if (char === '>' || (char === '/' && source[i + 1] === '>')) break;
      if (/\s/.test(char)) { i++; continue; }
      if (char === '{') { i = skipBraces(source, i); continue; } // a spread
      const name = /^[A-Za-z_][\w:-]*/.exec(source.slice(i));
      if (!name) { i++; continue; }
      i += name[0].length;
      if (source[i] !== '=') { attributes.push({name: name[0]}); continue; }
      i++;
      if (source[i] === '"' || source[i] === '\'') {
        const end = skipString(source, i);
        attributes.push({name: name[0], literal: source.slice(i + 1, end)});
        i = end + 1;
      } else if (source[i] === '{') {
        const end = skipBraces(source, i);
        attributes.push({name: name[0], expression: source.slice(i + 1, end - 1).trim()});
        i = end;
      }
    }
    const line = source.slice(0, match.index).split('\n').length;
    elements.push({file, tag: match[1], line, attributes});
  }
  return elements;
}

/**
 * Blank out comments (keeping every newline, so line numbers still point at the
 * source): prose like "a real `<button>`" must not read as an element.
 */
function stripComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;])\/\/.*$/gm, (comment, lead: string) => lead + blank(comment.slice(lead.length)));
}

function allElements(): JsxElement[] {
  return Object.entries(SOURCES).flatMap(([path, source]) => openingTags(path.split('/').at(-1)!, stripComments(source)));
}

function isInteractive(element: JsxElement): boolean {
  return INTERACTIVE_TAGS.has(element.tag) || element.attributes.some(attr => INTERACTIVE_HANDLERS.has(attr.name));
}

describe('harness allowlist', () => {
  const elements = allElements();
  const interactive = elements.filter(isInteractive);
  const addressed = addressedAttributes();

  it('finds the components and their controls, so the scan is not vacuous', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
    expect(interactive.length).toBeGreaterThan(30);
    expect(interactive.some(element => element.attributes.some(attr => attr.literal === 'shipBtn'))).toBe(true);
  });

  it('gives every interactive control a harness path, or a reason it has none', () => {
    const unreachable: string[] = [];
    for (const element of interactive) {
      const where = `${element.file}:${element.line} <${element.tag}>`;
      const id = element.attributes.find(attr => attr.name === 'id');
      const dataAttributes = element.attributes.filter(attr => attr.name.startsWith('data-'));
      const byAttribute = dataAttributes.some(attr => addressed.has(attr.name));

      for (const attr of dataAttributes) {
        if (!addressed.has(attr.name) && !(attr.name in EXCLUDED_ATTRS)) {
          unreachable.push(`${where}: ${attr.name} is not addressed by any allowlisted target`);
        }
      }

      if (id?.literal !== undefined) {
        if (!ID_TARGETS.has(id.literal) && !(id.literal in EXCLUDED_IDS) && !byAttribute) {
          unreachable.push(`${where}: id "${id.literal}" is not allowlisted`);
        }
        continue;
      }
      if (id?.expression !== undefined) {
        if (!byAttribute && !(`${element.file}:${id.expression}` in DYNAMIC_IDS)) {
          unreachable.push(`${where}: dynamic id {${id.expression}} has no allowlisted attribute or listed reason`);
        }
        continue;
      }
      if (!byAttribute) unreachable.push(`${where}: no id and no allowlisted attribute`);
    }
    expect(unreachable).toEqual([]);
  });

  it('allowlists every close button a card header renders', () => {
    const closeIds = elements.flatMap(element => element.attributes.filter(attr => attr.name === 'closeId' && attr.literal !== undefined));
    expect(closeIds.length).toBeGreaterThan(5);
    for (const attr of closeIds) expect(ID_TARGETS.has(attr.literal!), attr.literal).toBe(true);
  });

  it('allowlists every inventory slot, decorations included, from the shared table', () => {
    for (const id of allSlotButtonIds()) expect(ID_TARGETS.has(id), id).toBe(true);
    for (const id of DECOR_IDS) expect(ID_TARGETS.has(`decor:${id}SlotBtn`), id).toBe(true);
    // The save schema and the inventory agree on which decorations exist.
    expect([...decorIdSchema.options]).toEqual([...DECOR_IDS]);
  });

  it('keeps every exclusion live: nothing listed that the tree no longer renders or already reaches', () => {
    const literalIds = new Set(interactive.flatMap(element => element.attributes.filter(attr => attr.name === 'id' && attr.literal).map(attr => attr.literal!)));
    for (const id of Object.keys(EXCLUDED_IDS)) {
      expect(literalIds.has(id), `excluded id ${id} is not rendered any more`).toBe(true);
      expect(ID_TARGETS.has(id), `excluded id ${id} is allowlisted after all`).toBe(false);
    }
    const dynamicIds = new Set(interactive.flatMap(element => element.attributes
      .filter(attr => attr.name === 'id' && attr.expression !== undefined)
      .map(attr => `${element.file}:${attr.expression}`)));
    for (const key of Object.keys(DYNAMIC_IDS)) expect(dynamicIds.has(key), `${key} is not rendered any more`).toBe(true);
  });

  it('declares every attribute target in exactly one form', () => {
    for (const name of KIND_TARGETS) expect(ATTR_TARGETS.has(name), name).toBe(true);
    for (const name of FLAG_ATTR_TARGETS) expect(ATTR_TARGETS.has(name), name).toBe(false);
  });
});
