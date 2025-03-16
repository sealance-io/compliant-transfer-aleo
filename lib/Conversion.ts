export function stringToBigInt(asciiString) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}