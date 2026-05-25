"""
Deterministic ID generation for workspace tasks.

ID format:  [3-char author prefix][Base62(global_counter)]
Examples:   usr1, dsp2, slv3, exe4, tst5, usr1a, ...

Base62 alphabet:  0-9 a-z A-Z  (62 symbols)
Counter:          never decremented — protects against ID reuse in git history
"""

BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

VALID_PREFIXES = {"usr", "dsp", "slv", "exe", "tst"}


def to_base62(n: int) -> str:
    """Encode a non-negative integer as a Base62 string."""
    if n < 0:
        raise ValueError(f"n must be >= 0, got {n}")
    if n == 0:
        return "0"
    digits: list[str] = []
    while n:
        digits.append(BASE62[n % 62])
        n //= 62
    return "".join(reversed(digits))


def from_base62(s: str) -> int:
    """Decode a Base62 string to an integer."""
    result = 0
    for ch in s:
        result = result * 62 + BASE62.index(ch)
    return result


def make_id(prefix: str, counter: int) -> str:
    """
    Build a task ID from an author prefix and the global counter.

    >>> make_id("usr", 1)
    'usr1'
    >>> make_id("dsp", 2)
    'dsp2'
    >>> make_id("exe", 62)
    'exe10'
    """
    return prefix + to_base62(counter)
