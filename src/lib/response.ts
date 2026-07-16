export function success<T>(data: T) {
  return { success: true, data };
}

export function error(code: string, message: string) {
  return { success: false, error: { code, message } };
}
