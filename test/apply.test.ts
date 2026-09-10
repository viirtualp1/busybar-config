import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defineConfigSpec, integerIn, matching } from 'busybar-kit/config-spec';
import { ConfigError, readConfig, writeConfig } from '../src/apply.js';
import type { ConfigurableApp } from '../src/discover.js';

const SPEC = defineConfigSpec({
  name: 'demo',
  sections: [
    {
      kind: 'env',
      file: '.env',
      title: 'Settings',
      reloads: 'restart',
      fields: [
        { key: 'STEAM_ID', label: 'Steam ID', type: 'text' },
        { key: 'API_KEY', label: 'API key', type: 'secret' },
        {
          key: 'PORT',
          label: 'Port',
          type: 'number',
          rules: [integerIn(1024, 65_535)],
        },
      ],
    },
    {
      kind: 'list',
      file: 'trips.json',
      title: 'Trips',
      reloads: 'live',
      summary: '{number}',
      header: [{ key: 'timezone', label: 'Timezone', type: 'text' }],
      at: 'items',
      fields: [
        {
          key: 'number',
          label: 'Number',
          type: 'text',
          rules: [matching('^[A-Z]{2}\\d+$', 'two letters then digits')],
        },
      ],
    },
  ],
});

/** A throwaway profile directory holding one app's config. */
function scratch(): { app: ConfigurableApp; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'busybar-apply-'));

  return {
    app: { spec: SPEC, packageName: 'busybar-demo', dir },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('a secret is described, never handed over', () => {
  const { app, done } = scratch();
  try {
    writeFileSync(join(app.dir, '.env'), 'STEAM_ID=765\nAPI_KEY=abcdef\n');
    const snapshot = readConfig(app);
    const env = snapshot.sections['.env'] as Record<string, unknown>;

    assert.equal(env['STEAM_ID'], '765');
    assert.deepEqual(env['API_KEY'], { set: true, length: 6 });
  } finally {
    done();
  }
});

test('a secret nobody has set reads as unset', () => {
  const { app, done } = scratch();
  try {
    const env = readConfig(app).sections['.env'] as Record<string, unknown>;
    assert.deepEqual(env['API_KEY'], { set: false });
  } finally {
    done();
  }
});

test('an empty secret leaves the one already there', () => {
  const { app, done } = scratch();
  try {
    writeFileSync(join(app.dir, '.env'), 'API_KEY=keepme\n');
    writeConfig(app, { section: '.env', values: { API_KEY: '' } });

    assert.match(readFileSync(join(app.dir, '.env'), 'utf8'), /API_KEY=keepme/);
  } finally {
    done();
  }
});

test('null is how you clear a setting, secret or not', () => {
  const { app, done } = scratch();
  try {
    writeFileSync(join(app.dir, '.env'), 'API_KEY=gone\nSTEAM_ID=765\n');
    writeConfig(app, { section: '.env', values: { API_KEY: null, STEAM_ID: null } });

    const text = readFileSync(join(app.dir, '.env'), 'utf8');
    assert.match(text, /^# API_KEY=$/m);
    assert.match(text, /^# STEAM_ID=$/m);
  } finally {
    done();
  }
});

test('a value the spec refuses is refused here too, before it reaches the file', () => {
  const { app, done } = scratch();
  try {
    assert.throws(
      () => writeConfig(app, { section: '.env', values: { PORT: '80' } }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.kind === 'invalid' &&
        /Port: between 1024 and 65535/.test(error.message),
    );
    assert.equal(readConfig(app).sections['.env']?.['PORT' as never], '');
  } finally {
    done();
  }
});

test('a setting the spec does not have is refused rather than written', () => {
  const { app, done } = scratch();
  try {
    assert.throws(
      () => writeConfig(app, { section: '.env', values: { NOPE: 'x' } }),
      /no setting called NOPE/,
    );
  } finally {
    done();
  }
});

test('an unknown section is a not-found, not a crash', () => {
  const { app, done } = scratch();
  try {
    assert.throws(
      () => writeConfig(app, { section: 'nope.json', entries: [] }),
      (error: unknown) => error instanceof ConfigError && error.kind === 'not-found',
    );
  } finally {
    done();
  }
});

test('whether a change needs a restart comes from the spec', () => {
  const { app, done } = scratch();
  try {
    assert.equal(writeConfig(app, { section: '.env', values: {} }).restartRequired, true);
    assert.equal(
      writeConfig(app, { section: 'trips.json', entries: [] }).restartRequired,
      false,
      'dota-style live sections say so',
    );
  } finally {
    done();
  }
});

test('records are validated before any of them is written', () => {
  const { app, done } = scratch();
  try {
    writeConfig(app, { section: 'trips.json', entries: [{ number: 'SU100' }] });
    assert.throws(
      () =>
        writeConfig(app, {
          section: 'trips.json',
          entries: [{ number: 'SU100' }, { number: 'nope' }],
        }),
      /Number: two letters then digits/,
    );

    const back = readConfig(app).sections['trips.json'] as {
      entries: Record<string, string>[];
    };
    assert.deepEqual(
      back.entries,
      [{ number: 'SU100' }],
      'the refused batch left the file exactly as it was',
    );
  } finally {
    done();
  }
});

test('the settings beside a list are read and written with it', () => {
  const { app, done } = scratch();
  try {
    writeConfig(app, {
      section: 'trips.json',
      entries: [{ number: 'SU100' }],
      header: { timezone: 'Asia/Tbilisi' },
    });

    const section = readConfig(app).sections['trips.json'] as {
      header: Record<string, string>;
      entries: Record<string, string>[];
    };
    assert.equal(section.header['timezone'], 'Asia/Tbilisi');
    assert.equal(section.entries.length, 1);

    const raw = JSON.parse(readFileSync(join(app.dir, 'trips.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    assert.ok('items' in raw, 'and the records go under the key the spec named');
  } finally {
    done();
  }
});

/**
 * An app with more settings than fit under one heading groups them — and they
 * all still live in one `.env`. The file is the unit of storage; a section is
 * a heading over it.
 */
const GROUPED = defineConfigSpec({
  name: 'grouped',
  sections: [
    {
      kind: 'env',
      file: '.env',
      title: 'Connection',
      reloads: 'restart',
      fields: [{ key: 'HOST', label: 'Host', type: 'text' }],
    },
    {
      kind: 'env',
      file: '.env',
      title: 'Display',
      reloads: 'live',
      fields: [
        {
          key: 'MAX_AVATARS',
          label: 'How many',
          type: 'number',
          rules: [integerIn(1, 7)],
        },
        { key: 'GAIN', label: 'Gain', type: 'text' },
      ],
    },
  ],
});

function grouped(): { app: ConfigurableApp; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'busybar-grouped-'));

  return {
    app: { spec: GROUPED, packageName: 'busybar-grouped', dir },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('a setting from any heading can be saved, not just the first', () => {
  const { app, done } = grouped();
  try {
    // The bug this replaces: the write resolved the file to the first section
    // that named it, so anything grouped under a later heading came back as
    // "no setting called MAX_AVATARS".
    writeConfig(app, { section: '.env', values: { MAX_AVATARS: '3' } });

    assert.match(readFileSync(join(app.dir, '.env'), 'utf8'), /MAX_AVATARS=3/);
  } finally {
    done();
  }
});

test('settings from every heading are read back, not only the last', () => {
  const { app, done } = grouped();
  try {
    writeFileSync(join(app.dir, '.env'), 'HOST=example\nMAX_AVATARS=4\nGAIN=1.2\n');
    const env = readConfig(app).sections['.env'] as Record<string, unknown>;

    assert.equal(env['HOST'], 'example', 'the first heading survived the second');
    assert.equal(env['MAX_AVATARS'], '4');
    assert.equal(env['GAIN'], '1.2');
  } finally {
    done();
  }
});

test('a heading that reloads live does not excuse one that needs a restart', () => {
  const { app, done } = grouped();
  try {
    const result = writeConfig(app, { section: '.env', values: { MAX_AVATARS: '3' } });

    assert.equal(result.restartRequired, true, 'Connection still needs one');
  } finally {
    done();
  }
});

test('a key no heading declares is still refused', () => {
  const { app, done } = grouped();
  try {
    assert.throws(
      () => writeConfig(app, { section: '.env', values: { NONSENSE: 'x' } }),
      (error: unknown) =>
        error instanceof ConfigError && /no setting called NONSENSE/.test(error.message),
    );
  } finally {
    done();
  }
});

test('the rules of the heading a field belongs to still apply', () => {
  const { app, done } = grouped();
  try {
    assert.throws(
      () => writeConfig(app, { section: '.env', values: { MAX_AVATARS: '99' } }),
      (error: unknown) => error instanceof ConfigError && error.kind === 'invalid',
    );
  } finally {
    done();
  }
});
