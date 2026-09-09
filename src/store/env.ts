/**
 * Reading and writing a `.env` without wrecking it.
 *
 * These files are hand-written and heavily commented — every app ships an
 * `.env.example` that explains each setting — so an editor that reformatted
 * them on save would be worse than no editor. Lines are kept exactly as they
 * were; setting a key rewrites one line in place, and a key that was not there
 * is appended at the end.
 */

export type EnvFile = {
  lines: string[];
  /** Key to the index of the line that sets it. Later wins, as dotenv does. */
  index: Map<string, number>;
};

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export function parseEnv(text: string): EnvFile {
  const lines = text.length === 0 ? [] : text.split(/\r?\n/);
  const index = new Map<string, number>();

  lines.forEach((line, at) => {
    const match = ASSIGNMENT.exec(line);
    if (match?.[1] && !line.trimStart().startsWith('#')) {
      index.set(match[1], at);
    }
  });

  return { lines, index };
}

export function readValue(file: EnvFile, key: string): string {
  const at = file.index.get(key);
  if (at === undefined) {
    return '';
  }

  return unquote(ASSIGNMENT.exec(file.lines[at] ?? '')?.[2] ?? '');
}

export function values(file: EnvFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of file.index.keys()) {
    out[key] = readValue(file, key);
  }

  return out;
}

/**
 * An empty value clears the setting rather than writing `KEY=`, because every
 * app treats "absent" and "empty" the same and an empty line reads as a
 * mistake. A key that was commented out is left commented; the new line goes
 * after it, so the explanation above it still applies.
 */
export function setValue(file: EnvFile, key: string, value: string): EnvFile {
  const lines = [...file.lines];
  const at = file.index.get(key);
  const written = `${key}=${quote(value)}`;

  if (at !== undefined) {
    lines[at] = value === '' ? `# ${key}=` : written;
  } else if (value !== '') {
    if (lines.length > 0 && lines[lines.length - 1]?.trim() !== '') {
      lines.push('');
    }
    lines.push(written);
  }

  return parseEnv(lines.join('\n'));
}

export function serialise(file: EnvFile): string {
  const text = file.lines.join('\n');

  return text.endsWith('\n') || text === '' ? text : `${text}\n`;
}

/** Values only need quoting when they carry something a reader would trip on. */
function quote(value: string): string {
  return /^[^\s"'#][^"'#]*$/.test(value) || value === '' ? value : JSON.stringify(value);
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^"(.*)"$/.exec(trimmed) ?? /^'(.*)'$/.exec(trimmed);
  if (!quoted) {
    // An unquoted value runs to a comment, the way dotenv reads it.
    return trimmed.replace(/\s+#.*$/, '').trim();
  }

  try {
    return trimmed.startsWith('"') ? (JSON.parse(trimmed) as string) : (quoted[1] ?? '');
  } catch {
    return quoted[1] ?? '';
  }
}
