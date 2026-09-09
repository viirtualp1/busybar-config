import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { AppConfigSpec } from 'busybar-kit/config-spec';
import { profileAt, type ProfileResolver } from 'busybar-kit/profile';

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
  load?: (path: string) => Promise<unknown>;
};

/**
 * Which installed packages describe their own settings.
 *
 * A package opts in with a `busybar.config` field pointing at a module whose
 * default export is a spec. Scanning `node_modules` rather than reading the
 * window manager's manifest is deliberate: a package you have installed is
 * configurable whether or not you have got round to putting it on the Bar.
 */
export async function discover(
  profileDir: string,
  options: DiscoverOptions = {},
): Promise<{ apps: ConfigurableApp[]; problems: string[] }> {
  const readdir = options.readdir ?? defaultReaddir;
  const readPackage = options.readPackage ?? defaultReadPackage;
  const load = options.load ?? defaultLoad;
  const profile = profileAt(profileDir);

  const apps: ConfigurableApp[] = [];
  const problems: string[] = [];

  for (const packageName of readdir(join(profileDir, 'node_modules')).sort()) {
    if (packageName.startsWith('.') || packageName.startsWith('@')) {
      continue;
    }

    const root = join(profileDir, 'node_modules', packageName);
    const manifest = readPackage(join(root, 'package.json'));
    const relative = configField(manifest);
    if (!relative) {
      continue;
    }

    try {
      const module = await load(join(root, relative));
      const spec = specOf(module);
      if (!spec) {
        problems.push(`${packageName}: busybar.config has no spec as its default export`);
        continue;
      }
      apps.push({ spec, packageName, dir: appDir(profile, spec.name) });
    } catch (error) {
      problems.push(
        `${packageName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { apps, problems };
}

function appDir(profile: ProfileResolver, name: string): string {
  return profile.cwdFor(name);
}

function configField(manifest: unknown): string | undefined {
  if (!isRecord(manifest)) {
    return undefined;
  }
  const busybar = manifest['busybar'];
  if (!isRecord(busybar)) {
    return undefined;
  }
  const config = busybar['config'];

  return typeof config === 'string' && config.trim() ? config : undefined;
}

function specOf(module: unknown): AppConfigSpec | undefined {
  const candidate = isRecord(module) ? module['default'] : undefined;
  if (!isRecord(candidate)) {
    return undefined;
  }
  const { name, sections } = candidate;

  return typeof name === 'string' && Array.isArray(sections)
    ? (candidate as unknown as AppConfigSpec)
    : undefined;
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

function defaultLoad(path: string): Promise<unknown> {
  return import(pathToFileURL(path).href) as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
