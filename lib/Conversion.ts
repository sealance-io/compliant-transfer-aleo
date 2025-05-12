import { bech32m } from "@scure/base";
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
  const fieldElement = new BN(bytes, 16, "le").toString();
  return BigInt(fieldElement);
}

export function convertFieldToAddress(field: string): string {
  const prefix = "aleo";
  const bn = new BN(field.slice(0, field.length - "field".length), 10);
  const bytes = bn.toArray("le", 32); // get 32 bytes, little-endian
  const words = bech32m.toWords(Uint8Array.from(bytes));
  const address = bech32m.encode(prefix, words);
  return address;
}
