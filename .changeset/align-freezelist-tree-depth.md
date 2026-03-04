---
"@sealance-io/policy-engine-aleo": minor
---

**Breaking:** `getSiblingPath` third parameter renamed from `depth` (path length) to `maxTreeDepth` (tree depth, default: 15). Callers passing `16` should now pass `15` or omit the argument. The function internally pads to `maxTreeDepth + 1` elements.
