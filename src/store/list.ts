import type { ListSection } from 'busybar-kit/config-spec';

/**
 * The records inside a JSON config, and the file they came out of.
 *
 * The file is more than the list: dota's `schedule.json` wraps its matches in
 * an object holding the timezone, the day, and a `_comment` block explaining
 * the format. All of that has to come back out unchanged, so the whole document
 * is carried around and only the array is replaced.
 */
export type ListFile = {
  /** The parsed document, or null when the file was not there. */
  document: unknown;
  entries: Record<string, string>[];
};

export function parseList(text: string | null, section: ListSection): ListFile {
  if (text === null || text.trim() === '') {
    return { document: null, entries: [] };
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${section.file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const raw = section.at
    ? isRecord(document)
      ? document[section.at]
      : undefined
    : document;

  if (raw === undefined || raw === null) {
    return { document, entries: [] };
  }
  if (!Array.isArray(raw)) {
    throw new Error(
      section.at
        ? `${section.file}: "${section.at}" should hold an array`
        : `${section.file} should hold an array`,
    );
  }

  return { document, entries: raw.map(toStrings) };
}

export function serialiseList(
  file: ListFile,
  entries: Record<string, string>[],
  section: ListSection,
): string {
  const cleaned = entries.map(dropEmpty);

  if (!section.at) {
    return `${JSON.stringify(cleaned, null, 2)}\n`;
  }

  const base = isRecord(file.document) ? { ...file.document } : {};
  // Assigning keeps the key where it already was, and puts a new one last —
  // after `_comment`, which is where a reader expects the data to start.
  base[section.at] = cleaned;

  return `${JSON.stringify(base, null, 2)}\n`;
}

/** Header settings live beside the array, not inside it. */
export function readHeader(file: ListFile, keys: readonly string[]) {
  const out: Record<string, string> = {};
  if (!isRecord(file.document)) {
    return out;
  }
  for (const key of keys) {
    out[key] = asText(file.document[key]);
  }

  return out;
}

export function writeHeader(file: ListFile, header: Record<string, string>): ListFile {
  const base = isRecord(file.document) ? { ...file.document } : {};
  for (const [key, value] of Object.entries(header)) {
    if (value === '') {
      delete base[key];
    } else {
      base[key] = value;
    }
  }

  return { ...file, document: base };
}

/**
 * Everything is edited as text, but numbers were numbers in the file and should
 * go back as numbers — `"bo": 3`, not `"bo": "3"`.
 */
function dropEmpty(entry: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === '') {
      continue;
    }
    out[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }

  return out;
}

function toStrings(entry: unknown): Record<string, string> {
  if (!isRecord(entry)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry)) {
    const text = asText(value);
    if (text !== '') {
      out[key] = text;
    }
  }

  return out;
}

/** Only the scalars a config file can hold; anything else is not a setting. */
function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
