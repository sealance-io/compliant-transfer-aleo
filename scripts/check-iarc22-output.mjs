// Leo may echo .env contents on failure. Only sanitized diagnostics may enter errors or CI logs.
export function sanitizeLeoOutput(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map(line => {
      const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
      if (/(?:^|\s)(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/.test(plain)) {
        return "[redacted environment assignment]";
      }
      return plain.replace(/\bAPrivateKey1[A-Za-z0-9]+\b/g, "[redacted private key]");
    })
    .join("\n")
    .trim();
}

export function formatLeoFailure(args, result) {
  const diagnostics = sanitizeLeoOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const status = result.status === null ? `signal ${result.signal ?? "unknown"}` : `exit status ${result.status}`;
  return `leo --disable-update-check -q ${args.join(" ")} failed (${status})${diagnostics ? `\n${diagnostics}` : ""}`;
}

export function isInterfaceMismatchDiagnostic(output) {
  const diagnostic = sanitizeLeoOutput(output);
  return /\bdoes not satisfy\b/i.test(diagnostic) && /\bIARC22\b/i.test(diagnostic);
}
