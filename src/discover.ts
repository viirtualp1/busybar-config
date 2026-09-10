import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { parseSpec, parseSpecJson, type AppConfigSpec } from 'busybar-kit/config-spec';
import { profileAt } from 'busybar-kit/profile';

/** One app the editor can configure, and where its settings live. */
export type ConfigurableApp = {
  spec: AppConfigSpec;
  /** The package that supplied the spec. */
  packageName: string;
  /** `<profile>/<name>` — the directory the app runs in, and reads its .env from. */
  dir: string;
};

export type DiscoverOptions = {
  /** Injected by the tests. */
  readdir?: (path: string) => string[];
  readPackage?: (path: string) => unknown;
  readText?: (path: string) => string | undefined;
  load?: (path: string) => Promise<unknown>;
};

/**
 * Which installed packages describe their own settings.
 *
 * A package opts in with a `busybar` field in its package.json pointing at its
 * spec. Scanning `node_modules` rather than reading the window manager's
 * manifest is deliberate: a package you have installed is configurable whether
 * or not you have got round to putting it on the Bar. Nothing here knows the
 * name of any particular app — that is the whole point.
 */
export async function discover(
  profileDir: string,
  options: DiscoverOptions = {},
): Promise<{ apps: ConfigurableApp[]; problems: string[] }> {
  const readdir = options.readdir ?? defaultReaddir;
  const readPackage = options.readPackage ?? defaultReadPackage;
  const readText = options.readText ?? defaultReadText;
  const load = options.load ?? defaultLoad;
  const profile = profileAt(profileDir);

  const apps: ConfigurableApp[] = [];
  const problems: string[] = [];

  for (const packageName of readdir(join(profileDir, 'node_modules')).sort()) {
    if (packageName.startsWith('.') || packageName.startsWith('@')) {
      continue;
    }

    const root = join(profileDir, 'node_modules', packageName);
    const paths = configPaths(readPackage(join(root, 'package.json')));
    if (!paths) {
      continue;
    }

    try {
      const spec = await loadSpec(root, paths, { readText, load, packageName });
      apps.push({ spec, packageName, dir: profile.cwdFor(spec.name) });
    } catch (error) {
      problems.push(
        `${packageName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { apps, problems };
}

/**
 * JSON first. The module is a fallback for a package built before the spec
 * became data, and only a fallback: `import()` is cached for the life of the
 * process, so an edited spec would go unnoticed until a restart.
 */
async function loadSpec(
  root: string,
  paths: { json?: string; module?: string },
  deps: {
    readText: (path: string) => string | undefined;
    load: (path: string) => Promise<unknown>;
    packageName: string;
  },
): Promise<AppConfigSpec> {
  if (paths.json) {
    const text = deps.readText(join(root, paths.json));
    if (text !== undefined) {
      return parseSpecJson(text, deps.packageName);
    }
  }

  if (!paths.module) {
    throw new Error('busybar.configJson points at nothing');
  }

  const module = await deps.load(join(root, paths.module));
  const candidate = isRecord(module) ? module['default'] : undefined;

  return parseSpec(candidate, deps.packageName);
}

function configPaths(manifest: unknown): { json?: string; module?: string } | undefined {
  const busybar = isRecord(manifest) ? manifest['busybar'] : undefined;
  if (!isRecord(busybar)) {
    return undefined;
  }
  const json = asPath(busybar['configJson']);
  const module = asPath(busybar['config']);

  return (json ?? module)
    ? { ...(json ? { json } : {}), ...(module ? { module } : {}) }
    : undefined;
}

function asPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function defaultReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function defaultReadPackage(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function defaultReadText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function defaultLoad(path: string): Promise<unknown> {
  return import(pathToFileURL(path).href) as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
