import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { SPEC_VERSION } from 'busybar-kit/config-spec';
import { discover } from '../src/discover.js';

const PROFILE = join('/home/me', '.busybar');

const flights = {
  specVersion: SPEC_VERSION,
  name: 'flights',
  summary: 'trips',
  sections: [],
};

type Fake = {
  /** What package.json declares. */
  busybar?: { config?: string; configJson?: string };
  /** The file `configJson` points at, if it is there. */
  json?: string;
  /** The default export of the module `config` points at. */
  module?: unknown;
};

/** A profile whose node_modules holds exactly these packages. */
function fakeProfile(packages: Record<string, Fake>) {
  const find = (path: string) =>
    Object.keys(packages).find((key) =>
      path.startsWith(join(PROFILE, 'node_modules', key)),
    );

  return {
    readdir: (path: string) =>
      path === join(PROFILE, 'node_modules') ? Object.keys(packages) : [],
    readPackage: (path: string) => {
      const entry = packages[find(path) ?? ''];

      return entry?.busybar ? { busybar: entry.busybar } : {};
    },
    readText: (path: string) => packages[find(path) ?? '']?.json,
    load: (path: string) => {
      const entry = packages[find(path) ?? ''];
      if (entry?.module instanceof Error) {
        return Promise.reject(entry.module);
      }

      return Promise.resolve({ default: entry?.module });
    },
  };
}

test('a package that describes itself is offered for editing', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-flights': {
        busybar: { configJson: './dist/config-spec.json' },
        json: JSON.stringify(flights),
      },
    }),
  );

  assert.deepEqual(problems, []);
  assert.equal(apps.length, 1);
  assert.equal(apps[0]?.spec.name, 'flights');
  assert.equal(apps[0]?.packageName, 'busybar-flights');
});

test('config lives under the application name, not the package name', async () => {
  const { apps } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-flights': {
        busybar: { configJson: './dist/config-spec.json' },
        json: JSON.stringify(flights),
      },
    }),
  );

  assert.equal(apps[0]?.dir, join(PROFILE, 'flights'));
});

test('the JSON is preferred, because an imported module goes stale', async () => {
  const { apps } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-flights': {
        busybar: { configJson: './dist/config-spec.json', config: './dist/spec.js' },
        json: JSON.stringify(flights),
        module: { ...flights, summary: 'the stale one' },
      },
    }),
  );

  assert.equal(apps[0]?.spec.summary, 'trips');
});

test('a package built before the JSON existed still works', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-flights': {
        busybar: { configJson: './dist/config-spec.json', config: './dist/spec.js' },
        module: flights,
      },
    }),
  );

  assert.deepEqual(problems, []);
  assert.equal(apps[0]?.spec.name, 'flights');
});

test('packages that say nothing are passed over in silence', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({ typescript: {}, 'busybar-kit': {} }),
  );

  assert.deepEqual(apps, []);
  assert.deepEqual(problems, [], 'not describing settings is not a problem');
});

test('a spec that will not load is reported, and the rest still work', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-broken': {
        busybar: { config: './dist/spec.js' },
        module: new Error('boom'),
      },
      'busybar-flights': {
        busybar: { configJson: './dist/config-spec.json' },
        json: JSON.stringify(flights),
      },
    }),
  );

  assert.equal(apps.length, 1, 'one bad package does not take the editor down');
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /busybar-broken: boom/);
});

test('a spec from a version we do not know names the package to update', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-future': {
        busybar: { configJson: './dist/config-spec.json' },
        json: JSON.stringify({ ...flights, specVersion: 99 }),
      },
    }),
  );

  assert.deepEqual(apps, []);
  assert.match(problems[0] ?? '', /busybar-future: .*specVersion 99 is not 1/);
});

test('a module that exports the wrong thing is reported as such', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-odd': { busybar: { config: './dist/spec.js' }, module: { nope: true } },
    }),
  );

  assert.deepEqual(apps, []);
  assert.match(problems[0] ?? '', /busybar-odd/);
});

test('a profile with nothing installed is empty rather than broken', async () => {
  const { apps, problems } = await discover(PROFILE, fakeProfile({}));

  assert.deepEqual(apps, []);
  assert.deepEqual(problems, []);
});
