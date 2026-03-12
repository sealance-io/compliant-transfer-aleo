export function parseBooleanEnv(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const stringValue = String(value).toLowerCase().trim();

  // Values that should be interpreted as true
  if (["true", "t", "yes", "y", "1", "on", "enabled"].includes(stringValue)) {
    return true;
  }

  // Values that should be interpreted as false
  if (["false", "f", "no", "n", "0", "off", "disabled"].includes(stringValue)) {
    return false;
  }

  // For any other unexpected values, log a warning and use the default
  console.warn(`Warning: Unexpected boolean environment value "${value}" - using default (${defaultValue})`);
  return defaultValue;
}
