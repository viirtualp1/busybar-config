import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ListSection } from 'busybar-kit/config-spec';
import { parseList, readHeader, serialiseList, writeHeader } from '../src/store/list.js';

const FLIGHTS: ListSection = {
  kind: 'list',
  file: 'flights.json',
  title: 'Trips',
  summary: (entry) => entry.number ?? '',
  fields: [],
};

/** dota keeps its matches under a key, beside settings and a comment block. */
const SCHEDULE: ListSection = {
  ...FLIGHTS,
  file: 'schedule.json',
  at: 'matches',
  header: [
    { key: 'timezone', label: 'Timezone', type: 'text' },
    { key: 'date', label: 'Date', type: 'text' },
  ],
};

const SCHEDULE_JSON = JSON.stringify(
  {
    _comment: ['Copy to schedule.json and edit while the app runs.'],
    timezone: 'Asia/Tbilisi',
    date: '2026-09-10',
    matches: [{ teams: 'IW vs TSpirit', time: '06:00', bo: 3 }],
  },
  null,
  2,
);

test('a file that is just an array reads as one', () => {
  const file = parseList('[{"number":"SU100"}]', FLIGHTS);

  assert.deepEqual(file.entries, [{ number: 'SU100' }]);
});

test('a missing file is an empty list, not an error', () => {
  assert.deepEqual(parseList(null, FLIGHTS).entries, []);
  assert.deepEqual(parseList('   ', FLIGHTS).entries, []);
});

test('broken JSON says which file and why', () => {
  assert.throws(() => parseList('{oops', FLIGHTS), /flights\.json is not valid JSON/);
});

test('something that is not a list says so', () => {
  assert.throws(() => parseList('{"a":1}', FLIGHTS), /should hold an array/);
  assert.throws(
    () => parseList('{"matches":"nope"}', SCHEDULE),
    /"matches" should hold an array/,
  );
});

test('the records are found under their key', () => {
  const file = parseList(SCHEDULE_JSON, SCHEDULE);

  assert.equal(file.entries.length, 1);
  assert.equal(file.entries[0]?.teams, 'IW vs TSpirit');
  assert.equal(file.entries[0]?.bo, '3', 'and everything is edited as text');
});

test('the comment block explaining the format survives a write', () => {
  const file = parseList(SCHEDULE_JSON, SCHEDULE);
  const written = serialiseList(file, file.entries, SCHEDULE);
  const back = JSON.parse(written) as Record<string, unknown>;

  assert.deepEqual(back['_comment'], [
    'Copy to schedule.json and edit while the app runs.',
  ]);
  assert.equal(back['timezone'], 'Asia/Tbilisi');
});

test('numbers go back as numbers, the way they came out', () => {
  const file = parseList(SCHEDULE_JSON, SCHEDULE);
  const back = JSON.parse(serialiseList(file, file.entries, SCHEDULE)) as {
    matches: { bo: unknown; teams: unknown }[];
  };

  assert.equal(back.matches[0]?.bo, 3);
  assert.equal(typeof back.matches[0]?.bo, 'number');
  assert.equal(typeof back.matches[0]?.teams, 'string');
});

test('a field left empty is left out rather than written as ""', () => {
  const written = serialiseList(
    parseList('[]', FLIGHTS),
    [{ number: 'SU100', aircraft: '' }],
    FLIGHTS,
  );

  assert.deepEqual(JSON.parse(written), [{ number: 'SU100' }]);
});

test('the settings beside the list are read and written in place', () => {
  const file = parseList(SCHEDULE_JSON, SCHEDULE);

  assert.deepEqual(readHeader(file, ['timezone', 'date']), {
    timezone: 'Asia/Tbilisi',
    date: '2026-09-10',
  });

  const updated = writeHeader(file, { timezone: 'Europe/Berlin', date: '' });
  const back = JSON.parse(serialiseList(updated, file.entries, SCHEDULE)) as Record<
    string,
    unknown
  >;

  assert.equal(back['timezone'], 'Europe/Berlin');
  assert.ok(!('date' in back), 'and an emptied one is dropped');
  assert.ok('_comment' in back, 'without disturbing the rest');
});

test('a brand new list file is written as a plain array', () => {
  const written = serialiseList(parseList(null, FLIGHTS), [{ number: 'SU1' }], FLIGHTS);

  assert.equal(written, '[\n  {\n    "number": "SU1"\n  }\n]\n');
});
