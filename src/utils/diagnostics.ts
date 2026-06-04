const SECRET_KEY_PATTERN = /(token|secret|key|authorization|cookie|session|jwt|rapidapi|service_role|anon)/i
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const LONG_KEY_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g

export function redactDiagnosticsValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '[redacted]'
  if (typeof value === 'string') {
    return value
      .replace(JWT_PATTERN, '[redacted-jwt]')
      .replace(LONG_KEY_PATTERN, (match) => (/^[0-9a-f-]{32,36}$/i.test(match) ? match : '[redacted-key]'))
  }
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticsValue(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactDiagnosticsValue(entryValue, entryKey)]))
  }
  return value
}

export function diagnosticsText(input: Record<string, unknown>): string {
  return JSON.stringify(redactDiagnosticsValue(input), null, 2)
}
