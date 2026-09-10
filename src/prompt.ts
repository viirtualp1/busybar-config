import * as p from '@clack/prompts';
import type { ConfigField } from 'busybar-kit/config-spec';
import { validateValue } from 'busybar-kit/rules';

/** What the user typed, or nothing when they backed out. */
export type Answer = { value: string } | { cancelled: true };

export function cancelled(answer: Answer): answer is { cancelled: true } {
  return 'cancelled' in answer;
}

/**
 * A secret is never printed back. Showing it as the initial value would put it
 * in the scrollback of whatever terminal happens to be open, so the current one
 * is described rather than displayed, and an empty answer keeps it.
 */
export function describe(field: ConfigField, current: string): string {
  if (!current) {
    return field.fallback ? `default (${field.fallback})` : 'not set';
  }

  return field.type === 'secret' ? `set, ${current.length} characters` : current;
}

export async function askField(field: ConfigField, current: string): Promise<Answer> {
  const message = field.label;
  const hint = field.hint;

  if (field.type === 'select' && field.options) {
    const answer = await p.select({
      message,
      options: field.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.hint ? { hint: option.hint } : {}),
      })),
      initialValue: current || field.fallback || field.options[0]?.value,
    });

    return p.isCancel(answer) ? { cancelled: true } : { value: String(answer) };
  }

  if (field.type === 'boolean') {
    const answer = await p.confirm({
      message,
      initialValue: truthy(current || field.fallback || ''),
    });

    return p.isCancel(answer) ? { cancelled: true } : { value: answer ? '1' : '0' };
  }

  if (field.type === 'secret') {
    const answer = await p.password({
      message: current ? `${message} (empty keeps the one you have)` : message,
      validate: (value) => validateWith(field, value ?? '', current),
    });

    if (p.isCancel(answer)) {
      return { cancelled: true };
    }
    const typed = String(answer);

    return { value: typed === '' ? current : typed };
  }

  const answer = await p.text({
    message,
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(hint && field.type === 'path' ? { placeholder: hint } : {}),
    initialValue: current,
    defaultValue: '',
    validate: (value) => validateWith(field, value ?? '', current),
  });

  return p.isCancel(answer) ? { cancelled: true } : { value: String(answer).trim() };
}

function validateWith(
  field: ConfigField,
  value: string,
  current: string,
): string | undefined {
  // One interpreter, shared with the daemon and the browser, so a value the
  // CLI accepts is a value they accept.
  return validateValue(field.rules, value, field, current);
}

export function truthy(value: string): boolean {
  return value === '1' || /^(true|yes|on)$/i.test(value);
}
