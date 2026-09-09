import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import type {
  ConfigField,
  ConfigSection,
  EnvSection,
  ListSection,
} from 'busybar-kit/config-spec';
import type { ConfigurableApp } from './discover.js';
import { askField, cancelled, describe } from './prompt.js';
import { parseEnv, readValue, serialise, setValue } from './store/env.js';
import { parseList, readHeader, serialiseList, writeHeader } from './store/list.js';

const BACK = '__back__';

/** Walks one app until the user goes back. Returns false when they quit. */
export async function editApp(app: ConfigurableApp): Promise<boolean> {
  mkdirSync(app.dir, { recursive: true });

  for (;;) {
    const section =
      app.spec.sections.length === 1
        ? app.spec.sections[0]
        : await pickSection(app.spec.sections);

    if (section === undefined) {
      return true;
    }
    if (section === null) {
      return false;
    }

    const kept =
      section.kind === 'list'
        ? await editList(app, section)
        : await editEnv(app, section);

    if (!kept || app.spec.sections.length === 1) {
      return kept;
    }
  }
}

/** undefined = back, null = quit. */
async function pickSection(sections: ConfigSection[]) {
  const answer = await p.select({
    message: 'What are you changing?',
    options: [
      ...sections.map((section, at) => ({
        value: String(at),
        label: section.title,
        hint: section.file,
      })),
      { value: BACK, label: '← back' },
    ],
  });

  if (p.isCancel(answer)) {
    return null;
  }

  return answer === BACK ? undefined : sections[Number(answer)];
}

// --- Records -----------------------------------------------------------------

async function editList(app: ConfigurableApp, section: ListSection): Promise<boolean> {
  const path = join(app.dir, section.file);
  const file = parseList(existsSync(path) ? readFileSync(path, 'utf8') : null, section);
  const entries = [...file.entries];

  if (section.header?.length && file.document === null) {
    // A file that does not exist yet has no timezone or day in it, and the
    // records below would be unreadable without them.
    p.note(`${section.file} is new — the settings for the whole file come first.`);
    const header = await askAll(section.header, {});
    if (!header) {
      return true;
    }
    write(path, serialiseList(writeHeader(file, header), entries, section));
    return editList(app, section);
  }

  const choice = await p.select({
    message: section.title,
    options: [
      ...entries.map((entry, at) => ({
        value: String(at),
        label: section.summary(entry) || `entry ${at + 1}`,
      })),
      { value: 'add', label: '+ add a new one' },
      ...(section.header?.length
        ? [{ value: 'header', label: '⚙ settings for the whole file' }]
        : []),
      { value: BACK, label: '← back' },
    ],
    ...(entries.length === 0 && section.empty ? { message: section.empty } : {}),
  });

  if (p.isCancel(choice)) {
    return false;
  }
  if (choice === BACK) {
    return true;
  }

  if (choice === 'header' && section.header) {
    const header = await askAll(section.header, readHeader(file, keysOf(section.header)));
    if (header) {
      write(path, serialiseList(writeHeader(file, header), entries, section));
      p.log.success(`Saved ${path}`);
    }

    return editList(app, section);
  }

  if (choice === 'add') {
    const entry = await askAll(section.fields, {});
    if (entry) {
      entries.push(entry);
      write(path, serialiseList(file, entries, section));
      p.log.success(`Added ${section.summary(entry)}`);
    }

    return editList(app, section);
  }

  const at = Number(choice);
  const existing = entries[at];
  if (!existing) {
    return true;
  }

  const what = await p.select({
    message: section.summary(existing),
    options: [
      { value: 'edit', label: 'Change it' },
      { value: 'remove', label: 'Remove it' },
      { value: BACK, label: '← back' },
    ],
  });

  if (p.isCancel(what)) {
    return false;
  }

  if (what === 'remove') {
    const sure = await p.confirm({ message: `Remove ${section.summary(existing)}?` });
    if (!p.isCancel(sure) && sure) {
      entries.splice(at, 1);
      write(path, serialiseList(file, entries, section));
      p.log.success(`Removed. ${entries.length} left.`);
    }

    return editList(app, section);
  }

  if (what === 'edit') {
    const edited = await askAll(section.fields, existing);
    if (edited) {
      entries[at] = edited;
      write(path, serialiseList(file, entries, section));
      p.log.success(`Saved ${path}`);
    }
  }

  return editList(app, section);
}

/** Every field in order — the flow for one record. Null when backed out of. */
async function askAll(
  fields: ConfigField[],
  current: Record<string, string>,
): Promise<Record<string, string> | null> {
  const answers: Record<string, string> = { ...current };

  for (const field of fields.filter((one) => !one.advanced)) {
    const answer = await askField(field, current[field.key] ?? '');
    if (cancelled(answer)) {
      return null;
    }
    answers[field.key] = answer.value;
  }

  const rest = fields.filter((one) => one.advanced);
  if (rest.length === 0) {
    return answers;
  }

  const more = await p.confirm({
    message: `Set the other ${rest.length}?`,
    initialValue: false,
  });
  if (p.isCancel(more)) {
    return null;
  }
  if (!more) {
    return answers;
  }

  for (const field of rest) {
    const answer = await askField(field, current[field.key] ?? '');
    if (cancelled(answer)) {
      return null;
    }
    answers[field.key] = answer.value;
  }

  return answers;
}

// --- Settings ----------------------------------------------------------------

/**
 * Settings are picked from a list rather than marched through: there are more
 * of them than of the fields on a record, and you come here to change one.
 */
async function editEnv(app: ConfigurableApp, section: EnvSection): Promise<boolean> {
  const path = join(app.dir, section.file);
  const file = parseEnv(existsSync(path) ? readFileSync(path, 'utf8') : '');
  const plain = section.fields.filter((field) => !field.advanced);
  const advanced = section.fields.filter((field) => field.advanced);

  const choice = await p.select({
    message: `${app.spec.name} — ${section.title}`,
    maxItems: 12,
    options: [
      ...plain.map((field) => ({
        value: field.key,
        label: field.label,
        hint: describe(field, readValue(file, field.key)),
      })),
      ...(advanced.length > 0
        ? [{ value: '__advanced__', label: `⚙ ${advanced.length} more settings` }]
        : []),
      { value: BACK, label: '← back' },
    ],
  });

  if (p.isCancel(choice)) {
    return false;
  }
  if (choice === BACK) {
    return true;
  }

  if (choice === '__advanced__') {
    const deeper = await p.select({
      message: 'More settings',
      maxItems: 12,
      options: [
        ...advanced.map((field) => ({
          value: field.key,
          label: field.label,
          hint: describe(field, readValue(file, field.key)),
        })),
        { value: BACK, label: '← back' },
      ],
    });

    if (p.isCancel(deeper)) {
      return false;
    }
    if (deeper !== BACK) {
      await writeOne(path, file, section, String(deeper));
    }

    return editEnv(app, section);
  }

  await writeOne(path, file, section, String(choice));

  return editEnv(app, section);
}

async function writeOne(
  path: string,
  file: ReturnType<typeof parseEnv>,
  section: EnvSection,
  key: string,
) {
  const field = section.fields.find((one) => one.key === key);
  if (!field) {
    return;
  }

  const answer = await askField(field, readValue(file, key));
  if (cancelled(answer)) {
    return;
  }
  write(path, serialise(setValue(file, key, answer.value)));
  p.log.success(`${field.label} → ${describe(field, answer.value)}`);
}

function keysOf(fields: ConfigField[]): string[] {
  return fields.map((field) => field.key);
}

function write(path: string, text: string) {
  writeFileSync(path, text);
}
