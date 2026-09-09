import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { discover } from '../src/discover.js';

const PROFILE = join('/home/me', '.busybar');

type Fake = { config?: string; spec?: unknown };

/** A profile whose node_modules holds exactly these packages. */
function fakeProfile(packages: Record<string, Fake>) {
  return {
    readdir: (path: string) =>
      path === join(PROFILE, 'node_modules') ? Object.keys(packages) : [],
    readPackage: (path: string) => {
      const name = Object.keys(packages).find((key) =>
        path.startsWith(join(PROFILE, 'node_modules', key)),
      );
      const entry = name ? packages[name] : undefined;

      return entry?.config ? { name, busybar: { config: entry.config } } : { name };
    },
    load: (path: string) => {
      const name = Object.keys(packages).find((key) =>
        path.startsWith(join(PROFILE, 'node_modules', key)),
      );
      const entry = name ? packages[name] : undefined;
      if (entry?.spec instanceof Error) {
        return Promise.reject(entry.spec);
      }

      return Promise.resolve({ default: entry?.spec });
    },
  };
}

const flights = { name: 'flights', summary: 'trips', sections: [] };

test('a package that describes itself is offered for editing', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-flights': { config: './dist/config-spec.js', spec: flights },
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
      'busybar-flights': { config: './dist/config-spec.js', spec: flights },
    }),
  );

  assert.equal(apps[0]?.dir, join(PROFILE, 'flights'));
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
        config: './dist/config-spec.js',
        spec: new Error('boom'),
      },
      'busybar-flights': { config: './dist/config-spec.js', spec: flights },
    }),
  );

  assert.equal(apps.length, 1, 'one bad package does not take the editor down');
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /busybar-broken: boom/);
});

test('a module that exports the wrong thing is reported as such', async () => {
  const { apps, problems } = await discover(
    PROFILE,
    fakeProfile({
      'busybar-odd': { config: './dist/config-spec.js', spec: { nope: true } },
    }),
  );

  assert.deepEqual(apps, []);
  assert.match(problems[0] ?? '', /no spec as its default export/);
});

test('a profile with nothing installed is empty rather than broken', async () => {
  const { apps, problems } = await discover(PROFILE, fakeProfile({}));

  assert.deepEqual(apps, []);
  assert.deepEqual(problems, []);
});
