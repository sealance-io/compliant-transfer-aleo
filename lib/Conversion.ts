import { bech32m } from '@scure/base';
import BN from "bn.js";

export function stringToBigInt(asciiString) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}

export function convertAddressToField(address: string): bigint {
  const { words } = bech32m.decode(address as `${string}1${string}`);
  const bytes = bech32m.fromWords(words);
  const fieldElement = (new BN(bytes, 16, 'le')).toString();
  return BigInt(fieldElement);
}