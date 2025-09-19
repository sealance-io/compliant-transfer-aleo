import { PrivateKey, Address, Signature } from "@provablehq/sdk";

export async function genSignature(privateKeyString: string, message: string) : Signature {

    const privateKey = PrivateKey.from_string(privateKeyString);
    const signature = privateKey.sign(message);

  return signature;
}