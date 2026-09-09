import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv, readValue, serialise, setValue, values } from '../src/store/env.js';

const SAMPLE = [
  '# --- Bar ---',
  'BUSY_ADDR=http://10.0.4.20',
  '',
  '# How often the source is asked.',
  'POLL_MS=5000',
  '# STRATZ_TOKEN=',
  'STEAM_API_KEY="a b c"',
  "QUOTED='single'",
  'TRAILING=value # and a note',
].join('\n');

test('values are read the way dotenv reads them', () => {
  const file = parseEnv(SAMPLE);

  assert.equal(readValue(file, 'BUSY_ADDR'), 'http://10.0.4.20');
  assert.equal(readValue(file, 'POLL_MS'), '5000');
  assert.equal(readValue(file, 'STEAM_API_KEY'), 'a b c', 'quotes come off');
  assert.equal(readValue(file, 'QUOTED'), 'single');
  assert.equal(readValue(file, 'TRAILING'), 'value', 'a trailing comment is not a value');
  assert.equal(readValue(file, 'MISSING'), '');
});

test('a commented-out key is not a value', () => {
  const file = parseEnv(SAMPLE);

  assert.equal(readValue(file, 'STRATZ_TOKEN'), '');
  assert.ok(!('STRATZ_TOKEN' in values(file)));
});

test('the comments explaining a file survive a write', () => {
  const written = serialise(setValue(parseEnv(SAMPLE), 'POLL_MS', '9000'));

  assert.match(written, /# How often the source is asked\.\nPOLL_MS=9000/);
  assert.match(written, /^# --- Bar ---/, 'and the heading above it');
  assert.equal(written.split('\n').length, SAMPLE.split('\n').length + 1);
});

test('a new key is appended rather than dropped into the middle', () => {
  const written = serialise(setValue(parseEnv(SAMPLE), 'LEAGUE_ID', '18323'));

  assert.match(written, /LEAGUE_ID=18323\n$/);
  assert.match(written, /POLL_MS=5000/, 'and everything else is still there');
});

test('clearing a setting comments it out instead of leaving KEY=', () => {
  const written = serialise(setValue(parseEnv(SAMPLE), 'POLL_MS', ''));

  assert.match(written, /^# POLL_MS=$/m);
  assert.doesNotMatch(written, /^POLL_MS=$/m);
});

test('a value that would confuse a reader is quoted, and comes back whole', () => {
  const once = setValue(parseEnv(''), 'KEY', 'a value # with a hash');
  const text = serialise(once);

  assert.match(text, /KEY="a value # with a hash"/);
  assert.equal(readValue(parseEnv(text), 'KEY'), 'a value # with a hash');
});

test('a plain value is left unquoted, because that is how people write them', () => {
  assert.match(serialise(setValue(parseEnv(''), 'PORT', '3080')), /^PORT=3080$/m);
});

test('an empty file is a fine place to start', () => {
  const file = parseEnv('');
  assert.deepEqual(values(file), {});
  assert.equal(serialise(setValue(file, 'A', '1')), 'A=1\n');
});

test('a key set twice reads as the last one, and the last one is edited', () => {
  const text = 'A=one\nA=two\n';
  const file = parseEnv(text);

  assert.equal(readValue(file, 'A'), 'two');
  assert.equal(serialise(setValue(file, 'A', 'three')), 'A=one\nA=three\n');
});
