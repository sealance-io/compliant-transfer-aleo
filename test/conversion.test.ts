import { convertAddressToField, convertFieldToAddress } from "../lib/Conversion";

describe("Aleo Address ↔ Field Conversion Tests", () => {
  // Known valid Aleo address/field pairs
  const testPairs = [
    {
      address: "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      field: "5647500843278657436949502497165670826559154521584843278499929363827537523field",
    },
    {
      address: "aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g",
      field: "7603387766041905219572337219377632096855488838114386943013822494617642751843field",
    },
  ];

  describe("Round-Trip Conversions", () => {
    describe("Address → Field → Address", () => {
      testPairs.forEach(({ address }) => {
        it(`preserves the original address: ${address.substring(0, 10)}...`, () => {
          const fieldValue = convertAddressToField(address);
          const field = fieldValue.toString() + "field";
          const roundTripAddress = convertFieldToAddress(field);
          expect(roundTripAddress).toBe(address);
        });
      });
    });

    describe("Field → Address → Field", () => {
      testPairs.forEach(({ field }) => {
        it(`preserves the original field: ${field.substring(0, 10)}...field`, () => {
          const address = convertFieldToAddress(field);
          const roundTripField = convertAddressToField(address).toString() + "field";
          expect(roundTripField).toBe(field);
        });
      });
    });
  });

  describe("Special Cases", () => {
    // Test boundary values
    const specialFields = [
      // Zero value
      "0field",

      // Small values
      "1field",
      "42field",

      // Large values (approaching field modulus upper bound)
      "28948022309329048855892746252171976963317496166410141009864396001977208667field",
      "28948022309329048855892746252171976963317496166410141009864396001977208666field",
    ];

    specialFields.forEach(field => {
      it(`handles special field value: ${field.substring(0, 10)}...`, () => {
        // Field → Address → Field
        const address = convertFieldToAddress(field);
        const roundTripField = convertAddressToField(address).toString() + "field";
        expect(roundTripField).toBe(field);
        expect(address).toMatch(/^aleo1[a-zA-Z0-9]{58}$/);
      });
    });
  });

  describe("Error Handling", () => {
    // Invalid address formats
    const invalidAddresses = [
      "", // Empty string
      "not_an_address", // Invalid format
      "aleo2abcdef", // Wrong prefix (should be aleo1)
      "btc1q7kp089mn09", // Valid bech32 but for Bitcoin
      "aleo1", // Too short
      "aleo1" + "a".repeat(300), // Too long
      "aleo1!@#$%^&*()", // Invalid characters
    ];

    invalidAddresses.forEach(address => {
      it(`rejects invalid address: ${address.substring(0, 15)}...`, () => {
        expect(() => convertAddressToField(address)).toThrow();
      });
    });

    // Invalid field formats
    const invalidFields = [
      "", // Empty string
      "not_a_field", // Not a number
      "12345", // Missing "field" suffix
      "field", // Just the suffix
      "-123field", // Negative number
      "1.23field", // Decimal number
      "0x123field", // Hexadecimal
    ];

    invalidFields.forEach(field => {
      it(`rejects invalid field: ${field}`, () => {
        expect(() => convertFieldToAddress(field)).toThrow();
      });
    });
  });

  describe("Format Validation", () => {
    it("produces addresses that comply with Aleo format", () => {
      // Generate addresses from different field values
      for (let i = 0; i < 5; i++) {
        const field = (BigInt(i) * BigInt(1000000) + BigInt(1)).toString() + "field";
        const address = convertFieldToAddress(field);

        // Check address format requirements
        expect(address).toMatch(/^aleo1/); // Starts with aleo1
        expect(address.length).toBe(63); // Correct length
        expect(address).toMatch(/^aleo1[a-z0-9]{58}$/); // Only contains valid characters

        // Verify it can be decoded back
        const roundTripField = convertAddressToField(address).toString() + "field";
        expect(roundTripField).toBe(field);
      }
    });

    it("handles maximum sized field values properly", () => {
      // Create a field value that approaches the maximum size
      // This is a 252-bit field element (close to maximum for BLS12-381 curve used by Aleo)
      const maxField = "28948022309329048855892746252171976963317496166410141009864396001977208667field";

      // Verify conversion works for large values
      const address = convertFieldToAddress(maxField);
      const roundTripField = convertAddressToField(address).toString() + "field";

      // Should get back the original value
      expect(roundTripField).toBe(maxField);
    });
  });

  describe("Multiple Round Trips", () => {
    it("preserves values through multiple conversion cycles", () => {
      // Start with valid address
      const initialAddress = testPairs[0].address;

      // Track values at each step
      let currentAddress = initialAddress;
      let currentField;

      // Perform multiple conversion cycles
      for (let i = 0; i < 3; i++) {
        // Convert to field
        currentField = convertAddressToField(currentAddress).toString() + "field";

        // Convert back to address
        currentAddress = convertFieldToAddress(currentField);

        // Check against original
        expect(currentAddress).toBe(initialAddress);
      }
    });
  });
});
