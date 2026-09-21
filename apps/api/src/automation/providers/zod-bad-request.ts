import { BadRequestException } from '@nestjs/common';

/**
 * Convert a thrown Zod validation error into the project's
 * legacy error type for the providers boundary.
 *
 * Providers have always thrown `BadRequestException` from their
 * `validateConfig()`; consumers (the runner, tests) catch on this
 * type. Now that validation is Zod-driven (project convention), we
 * wrap the thrown error so:
 *
 *   1. The existing public contract is preserved.
 *   2. The thrown message is human-readable (Zod's first issue
 *      message) rather than the structured `issues` array —
 *      the runner + tests log this string verbatim.
 *
 * Detection is deliberately structural — `err.name === 'ZodError'`
 * plus the presence of an `issues` array — so the API package
 * doesn't need to take a direct runtime dependency on the `zod`
 * package (Zod comes in transitively through `@workspace/shared`).
 */
interface ZodLikeError {
  name?: string;
  issues?: ReadonlyArray<{ path?: ReadonlyArray<unknown>; message?: string }>;
}

export function badRequestFromZod(err: unknown, fallbackMsg: string): never {
  const zodErr = err as ZodLikeError | null;
  if (zodErr !== null && zodErr.name === 'ZodError' && Array.isArray(zodErr.issues)) {
    const first = zodErr.issues[0];
    const path =
      Array.isArray(first?.path) && first.path.length > 0
        ? first.path.map((segment: unknown) => String(segment)).join('.')
        : '';
    const message = first?.message ?? fallbackMsg;
    const text = path.length > 0 ? `${path}: ${message}` : message;
    throw new BadRequestException(text);
  }
  throw err;
}
