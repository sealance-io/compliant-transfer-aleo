---
"@sealance-io/policy-engine-aleo": patch
---

Optimize `getLeafIndices()` by using binary search over the sorted leaf array. This preserves existing behavior for SDK-generated trees while reducing lookup time from O(n) to O(log n).
