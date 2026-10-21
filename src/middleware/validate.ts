import type { z } from 'zod';
import { badRequest } from '../utils/errors';

/** Parses `input` with `schema`, throwing a 400 with field-level details on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest('Validation failed', details);
  }
  return result.data;
}
