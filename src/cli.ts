#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as p from '@clack/prompts';
import { errorMessage } from 'busybar-kit/errors';
import { discover, type ConfigurableApp } from './discover.js';
import { editApp } from './flow.js';

const { profileArg } = parseArgs(process.argv.slice(2));
const profileDir = resolveProfile(profileArg);

p.intro('busybar-config');

if (!existsSync(join(profileDir, 'node_modules'))) {
  p.log.error(`No profile at ${profileDir}`);
  p.outro('Point it at one with --profile <dir>, or set WM_PROFILE.');
  process.exit(1);
}

const { apps, problems } = await discover(profileDir).catch((error: unknown) => {
  p.log.error(errorMessage(error));
  process.exit(1);
});

for (const problem of problems) {
  p.log.warn(problem);
}

if (apps.length === 0) {
  p.log.error('None of the installed packages describe their settings.');
  p.outro(`Looked in ${join(profileDir, 'node_modules')}`);
  process.exit(1);
}

p.log.info(profileDir);

for (;;) {
  const app = await pickApp(apps);
  if (!app) {
    break;
  }

  const kept = await editApp(app);
  if (!kept) {
    break;
  }
}

p.outro('Changes take effect the next time the app starts.');

async function pickApp(apps: ConfigurableApp[]): Promise<ConfigurableApp | null> {
  const answer = await p.select({
    message: 'Which app?',
    options: [
      ...apps.map((app) => ({
        value: app.spec.name,
        label: app.spec.name,
        ...(app.spec.summary ? { hint: app.spec.summary } : {}),
      })),
      { value: '__quit__', label: 'Done' },
    ],
  });

  if (p.isCancel(answer) || answer === '__quit__') {
    return null;
  }

  return apps.find((app) => app.spec.name === answer) ?? null;
}

/**
 * The same profile the window manager runs from. Falling back to the current
 * directory means running the editor inside a profile needs no arguments.
 */
function resolveProfile(argument: string | undefined): string {
  const named = argument || process.env['WM_PROFILE'] || '';

  return named ? resolve(expandHome(named)) : process.cwd();
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\')
    ? join(homedir(), path.slice(1))
    : path;
}

function parseArgs(argv: string[]): { profileArg?: string } {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--profile' || arg === '-p') {
      return { ...(argv[index + 1] ? { profileArg: argv[index + 1] as string } : {}) };
    }
    if (arg.startsWith('--profile=')) {
      return { profileArg: arg.slice('--profile='.length) };
    }
    if (!arg.startsWith('-')) {
      return { profileArg: arg };
    }
  }

  return {};
}
