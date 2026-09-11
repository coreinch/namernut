/**
 * Deterministic pseudo-random permutation of the integer range [0, size)
 * using a Feistel network with cycle-walking. This lets us visit every
 * index in a combination space exactly once, in a shuffled but repeatable
 * order, without ever allocating an array of that size (the word-pair
 * space here is in the hundreds of millions).
 */
export class ShuffledRange {
  private readonly size: number;
  private readonly halfBits: number;
  private readonly mask: number;
  private readonly seed: number;
  private readonly rounds = 4;

  constructor(size: number, seed: number) {
    this.size = size;
    const bits = Math.max(2, Math.ceil(Math.log2(size)));
    this.halfBits = Math.ceil(bits / 2);
    this.mask = (1 << this.halfBits) - 1;
    this.seed = seed >>> 0;
  }

  private round(value: number, roundIndex: number): number {
    const x = (value ^ (this.seed + roundIndex * 0x9e3779b1)) >>> 0;
    // Simple integer mix (variant of Murmur/xorshift finalizer).
    let h = x;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h & this.mask;
  }

  private feistel(input: number): number {
    let left = (input >>> this.halfBits) & this.mask;
    let right = input & this.mask;
    for (let r = 0; r < this.rounds; r++) {
      const newRight = (left ^ this.round(right, r)) & this.mask;
      left = right;
      right = newRight;
    }
    return ((left << this.halfBits) | right) >>> 0;
  }

  /** Maps a sequential index [0, size) to a shuffled index in the same range. */
  at(index: number): number {
    if (index < 0 || index >= this.size) {
      throw new RangeError(`index ${index} out of range [0, ${this.size})`);
    }
    let candidate = index;
    // Cycle-walk: keep re-applying the permutation until we land back
    // inside [0, size). The Feistel network is a bijection over the full
    // 2^bits domain, so iterating it always converges back into range.
    do {
      candidate = this.feistel(candidate);
    } while (candidate >= this.size);
    return candidate;
  }
}
