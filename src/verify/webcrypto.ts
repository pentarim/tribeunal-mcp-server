/**
 * Resolves the runtime's WebCrypto `SubtleCrypto` surface on both transports:
 * `globalThis.crypto.subtle` exists on Cloudflare Workers, browsers and Node
 * >= 19; Node 18 (still a supported stdio target) has no global `crypto`, so
 * we fall back to `node:crypto`'s `webcrypto.subtle`. That fallback import is
 * dynamic so this module never drags `node:crypto` into a Worker bundle that
 * never needs it.
 *
 * The surface is read through a local structural type rather than the DOM
 * lib's `SubtleCrypto` — this package's `tsconfig.json` has no `dom` lib (it
 * must stay compilable in the Workers type environment), and the two real
 * implementations already satisfy this narrower shape.
 */
export interface SubtleCryptoLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: string },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  verify(algorithm: string, key: unknown, signature: Uint8Array, data: Uint8Array): Promise<boolean>;
}

let cached: SubtleCryptoLike | undefined;

export async function subtle(): Promise<SubtleCryptoLike> {
  if (cached) return cached;
  const g = (globalThis as { crypto?: { subtle?: SubtleCryptoLike } }).crypto;
  if (g?.subtle) {
    cached = g.subtle;
    return cached;
  }
  // The specifier is built at runtime (not a literal `import('node:crypto')`)
  // so `tsc` never tries to resolve `node:crypto` types: `worker/tsconfig.json`
  // deliberately sets `types: []` (no @types/node) to stay compilable in the
  // Workers type environment, and a literal specifier there is a type error.
  const specifier = 'node:crypto';
  const nodeCrypto = (await import(specifier)) as { webcrypto: { subtle: SubtleCryptoLike } };
  cached = nodeCrypto.webcrypto.subtle as unknown as SubtleCryptoLike;
  return cached;
}
