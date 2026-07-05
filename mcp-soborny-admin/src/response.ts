export function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function jsonResponse(value: unknown) {
  return textResponse(JSON.stringify(value, jsonReplacer, 2));
}

export function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}
