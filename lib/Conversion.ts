import { bech32m } from "@scure/base";

export function stringToBigInt(asciiString: string) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}

/**
 * Converts an Aleo blockchain address to a field element.
 *
 * This function decodes a bech32m-encoded Aleo address and converts it to a field element
 * represented as a BigInt. The address format follows the Aleo protocol specification,
 * starting with the prefix "aleo1" followed by encoded data.
 *
 * @param address - The Aleo blockchain address (e.g., "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px")
 * @returns A BigInt representing the field element
 * @throws Error if the address is invalid or cannot be decoded
 */
export function convertAddressToField(address: string): bigint {
  const { words } = bech32m.decode(address as `${string}1${string}`);
  const bytes = bech32m.fromWords(words);

  // Convert bytes to BigInt (little-endian)
  let fieldValue = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    fieldValue |= BigInt(bytes[i]) << BigInt(i * 8);
  }

  return fieldValue;
}

/**
 * Converts a field element to an Aleo blockchain address.
 *
 * This function takes a field element (represented as a string with "field" suffix)
 * and converts it to a bech32m-encoded Aleo address. The resulting address
 * starts with the prefix "aleo1" followed by the encoded data.
 *
 * @param field - The field element as a string with "field" suffix (e.g., "123456field")
 * @returns The Aleo blockchain address
 * @throws Error if the field value is invalid or cannot be converted
 */
export function convertFieldToAddress(field: string): string {
  if (typeof field !== "string") {
    throw new Error("Field must be a string");
  }

  if (field.length === 0) {
    throw new Error("Field cannot be empty");
  }

  const suffix = "field";
  if (!field.endsWith(suffix)) {
    throw new Error('Field must end with "field" suffix');
  }

  const fieldNumeric = field.slice(0, field.length - suffix.length);

  if (fieldNumeric.length === 0) {
    throw new Error('Field must contain a numeric value before "field" suffix');
  }

  if (!/^\d+$/.test(fieldNumeric)) {
    throw new Error('Field must be a non-negative decimal number followed by "field"');
  }

  const prefix = "aleo";

  try {
    const fieldValue = BigInt(fieldNumeric);

    // Convert to 32-byte array (little-endian)
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = Number((fieldValue >> BigInt(i * 8)) & BigInt(0xff));
    }

    const words = bech32m.toWords(bytes);
    const address = bech32m.encode(prefix, words);

    return address;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error during conversion";

    throw new Error(`Invalid field value: ${errorMessage}`);
  }
}
