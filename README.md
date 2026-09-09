# busybar-config

> [!IMPORTANT]
> **Unofficial community project.** Built and maintained by [@viirtualp1](https://github.com/viirtualp1), **not** an official Flipper Devices / BUSY product, and not affiliated with, endorsed by, or supported by them. "BUSY Bar" remains their trademark. For the real hardware and official apps, visit **[busy.app](https://busy.app/)**.

An interactive editor for the settings of every BUSY Bar app you have
installed. Change the flight you are on without opening a JSON file and
counting brackets.

```bash
cd ~/.busybar && npx busybar-config
```

```
┌  busybar-config
│
◆  Which app?
│  ● flights      The flight you are on, or the next one you are taking
│  ○ dota         The pro match that is live, and the bracket around it
│  ○ mydota       Your own game, live off Dota 2 Game State Integration
│  ○ nowplaying   What is playing, with the cover art and the knob for volume
│  ○ livesplit    The splits and the running clock, off LiveSplit itself
│
◆  Trips
│  ● FX5279  DEL-CDG  2026-09-09 9:53  Boeing 777-F28
│  ○ + add a new one
│
◆  Flight number   FX5279
◆  Route           DEL-CDG
◆  Departure       2026-09-09 09:53
◆  Arrival         2026-09-09 17:00
◆  Aircraft        Boeing 777-F28
│
└  Saved ~/.busybar/flights/flights.json
```

## The apps describe themselves

This editor knows nothing about flights. `busybar-flights` knows that a route
reads `SVO-JFK` and that a departure is a local time with no zone on it, so it
says so, and the editor renders the questions:

```ts
// busybar-flights/src/config-spec.ts
export default defineConfigSpec({
  name: 'flights',
  sections: [
    {
      kind: 'list',
      file: 'flights.json',
      title: 'Trips',
      summary: (entry) => `${entry.number}  ${entry.route}  ${entry.departure}`,
      fields: [
        {
          key: 'route',
          label: 'Route',
          type: 'text',
          placeholder: 'SVO-JFK',
          validate: matching(/^[A-Za-z]{3}-[A-Za-z]{3}$/, 'three letters, a dash, three'),
        },
      ],
    },
  ],
});
```

A package opts in by pointing at that module:

```json
"busybar": { "config": "./dist/config-spec.js" }
```

Which means a new app becomes configurable the moment you install it, without a
line changing here. The spec type lives in
[busybar-kit](https://github.com/viirtualp1/busybar-kit) —
`busybar-kit/config-spec`.

## Two shapes, which is all anything needs

- **`list`** — a file of records you add to, edit and remove: flights, a
  tournament schedule. `at` names the key holding the array when the file wraps
  it in an object, and `header` describes the settings that sit beside it.
- **`env`** — plain settings, one key to a line.

A record is asked field by field, in order, because that is how you fill one in.
Settings are picked from a list showing what each is set to, because you came
here to change one of them, not all nine.

Anything marked `advanced` waits behind **more settings** — nobody retypes a
poll interval to correct a flight number.

## What it will not touch

**The Bar's own connection.** `BUSY_ADDR`, the token, the HTTP password and the
draw priority are absent from every app's spec on purpose: under
[busybar-wm](https://github.com/viirtualp1/busybar-wm) the supervisor supplies
them and replaces whatever an app sends, so offering to set them here would be
a lie. They belong to the profile, not to an app in it.

**Your formatting.** These files are hand-written and heavily commented. Lines
in a `.env` are kept exactly as they were and a change rewrites one line in
place; a JSON file keeps every key it had, including the `_comment` block that
explains its own format. Clearing a setting comments it out rather than leaving
a bare `KEY=`, because every app treats absent and empty the same and an empty
line reads as a mistake.

**Secrets.** A key or a token is never printed back — the prompt says
`set, 32 characters` and an empty answer keeps what is there.

## Where it looks

The profile: the directory holding your apps and their config, the same one
`busybar-wm --profile` runs from.

```bash
busybar-config                    # the current directory
busybar-config --profile ~/.busybar
WM_PROFILE=~/.busybar busybar-config
```

It scans `<profile>/node_modules` for packages that describe their settings, and
writes each app's config to `<profile>/<name>/` — the working directory that app
is started in, which is where it already reads its `.env` from.

A package that describes nothing is passed over in silence. One whose spec will
not load is reported, and the rest still work.

## Scripts

```bash
npm run check   # lint + typecheck + test
npm run build
```

MIT.
