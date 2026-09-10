import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AppConfigSpec,
  ConfigField,
  ConfigSection,
  EnvSection,
  ListSection,
} from 'busybar-kit/config-spec';
import { validateValue } from 'busybar-kit/rules';
import type { ConfigurableApp } from './discover.js';
import { parseEnv, readValue, serialise, setValue } from './store/env.js';
import { parseList, readHeader, serialiseList, writeHeader } from './store/list.js';

/**
 * Reading and writing an app's settings without a terminal — what the CLI does
 * interactively, done in one call, so a daemon or a GUI can do it too.
 *
 * The rules come from the app's own spec and are checked here as well as in
 * whatever client asked, because a client cannot be trusted and a config file
 * with a bad value in it is a crash at the app's next start.
 */

/** A secret is described, never handed over. */
export type SecretView = { set: true; length: number } | { set: false };

export type EnvValues = Record<string, string | SecretView>;

export type SectionValues =
  | EnvValues
  | Record<string, string>[]
  | { header: EnvValues; entries: Record<string, string>[] };

export type ConfigSnapshot = { sections: Record<string, SectionValues> };

/**
 * `null` clears a setting; `''` on a secret leaves the one already there, since
 * a client never had the value to send back.
 */
export type FieldWrite = string | null;

export type PutEnvBody = { section: string; values: Record<string, FieldWrite> };

export type PutListBody = {
  section: string;
  entries: Record<string, string>[];
  header?: Record<string, FieldWrite>;
};

export type PutConfigBody = PutEnvBody | PutListBody;

export type PutResult = { saved: true; restartRequired: boolean };

/**
 * Why a write was refused. Kinds rather than HTTP codes: this library is used
 * from a terminal too, where a 400 means nothing.
 */
export type ConfigErrorKind = 'not-found' | 'invalid';

export class ConfigError extends Error {
  constructor(
    readonly kind: ConfigErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readConfig(app: ConfigurableApp): ConfigSnapshot {
  const sections: Record<string, SectionValues> = {};

  for (const section of app.spec.sections) {
    if (section.kind !== 'env') {
      sections[section.file] = readListSection(app, section);
      continue;
    }

    // Several sections may describe the same file — an app with a dozen
    // settings will group them under headings, and they all still live in one
    // `.env`. The file is the unit of storage; a section is a heading over it.
    // So the values are merged rather than replaced, which is what the old
    // assignment did: every section but the last read back empty.
    sections[section.file] = {
      ...(asEnvValues(sections[section.file]) ?? {}),
      ...readEnvSection(app, section),
    };
  }

  return { sections };
}

export function writeConfig(app: ConfigurableApp, body: PutConfigBody): PutResult {
  mkdirSync(app.dir, { recursive: true });
  const sections = sectionsOf(app.spec, body.section);
  const first = sections[0] as ConfigSection;

  if (first.kind === 'env') {
    if (!('values' in body)) {
      throw new ConfigError('invalid', `${first.file} takes { values }`);
    }
    // Every field the file declares, wherever it was grouped.
    writeEnv(app, first.file, fieldsOf(sections), body.values);
  } else {
    if (!('entries' in body)) {
      throw new ConfigError('invalid', `${first.file} takes { entries }`);
    }
    writeList(app, first, body.entries, body.header);
  }

  // If any grouping over this file needs a restart, the file does.
  return {
    saved: true,
    restartRequired: sections.some((one) => (one.reloads ?? 'restart') === 'restart'),
  };
}

export function sectionOf(spec: AppConfigSpec, file: string): ConfigSection {
  return sectionsOf(spec, file)[0] as ConfigSection;
}

/** Every section describing this file, in the order the app declared them. */
export function sectionsOf(spec: AppConfigSpec, file: string): ConfigSection[] {
  const sections = spec.sections.filter((one) => one.file === file);
  if (sections.length === 0) {
    throw new ConfigError('not-found', `${spec.name} has no section ${file}`);
  }

  return sections;
}

function fieldsOf(sections: ConfigSection[]): ConfigField[] {
  return sections.flatMap((section) => section.fields);
}

function asEnvValues(values: SectionValues | undefined): EnvValues | null {
  return values && !Array.isArray(values) && !('entries' in values) ? values : null;
}

// --- Reading -----------------------------------------------------------------

function readEnvSection(app: ConfigurableApp, section: EnvSection): EnvValues {
  const file = parseEnv(read(join(app.dir, section.file)) ?? '');
  const out: EnvValues = {};
  for (const field of section.fields) {
    out[field.key] = describe(field, readValue(file, field.key));
  }

  return out;
}

function readListSection(app: ConfigurableApp, section: ListSection): SectionValues {
  const file = parseList(read(join(app.dir, section.file)), section);
  if (!section.header?.length) {
    return file.entries;
  }

  const raw = readHeader(
    file,
    section.header.map((field) => field.key),
  );
  const header: EnvValues = {};
  for (const field of section.header) {
    header[field.key] = describe(field, raw[field.key] ?? '');
  }

  return { header, entries: file.entries };
}

function describe(field: ConfigField, value: string): string | SecretView {
  if (field.type !== 'secret') {
    return value;
  }

  return value ? { set: true, length: value.length } : { set: false };
}

// --- Writing -----------------------------------------------------------------

function writeEnv(
  app: ConfigurableApp,
  name: string,
  fields: ConfigField[],
  values: Record<string, FieldWrite>,
): void {
  const path = join(app.dir, name);
  let file = parseEnv(read(path) ?? '');

  for (const [key, incoming] of Object.entries(values)) {
    const field = fieldOf(fields, key, name);
    const current = readValue(file, key);

    if (incoming === null) {
      file = setValue(file, key, '');
      continue;
    }
    // A client was never given the secret, so it cannot send it back; an empty
    // string means "leave it". Clearing one is `null`, said out loud.
    if (field.type === 'secret' && incoming === '') {
      continue;
    }

    check(field, incoming, current);
    file = setValue(file, key, incoming);
  }

  writeFileSync(path, serialise(file));
}

function writeList(
  app: ConfigurableApp,
  section: ListSection,
  entries: Record<string, string>[],
  header?: Record<string, FieldWrite>,
): void {
  const path = join(app.dir, section.file);
  let file = parseList(read(path), section);

  for (const entry of entries) {
    for (const field of section.fields) {
      check(field, entry[field.key] ?? '');
    }
  }

  if (header && section.header) {
    const resolved: Record<string, string> = {};
    for (const [key, incoming] of Object.entries(header)) {
      const field = fieldOf(section.header, key, section.file);
      const value = incoming ?? '';
      if (incoming !== null) {
        check(field, value);
      }
      resolved[key] = value;
    }
    file = writeHeader(file, resolved);
  }

  writeFileSync(path, serialiseList(file, entries, section));
}

function fieldOf(fields: ConfigField[], key: string, file: string): ConfigField {
  const field = fields.find((one) => one.key === key);
  if (!field) {
    throw new ConfigError('invalid', `${file} has no setting called ${key}`);
  }

  return field;
}

function check(field: ConfigField, value: string, current = ''): void {
  const error = validateValue(field.rules, value, field, current);
  if (error) {
    throw new ConfigError('invalid', `${field.label}: ${error}`);
  }
}

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
