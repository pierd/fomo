// Whose session a token is: its subject is "<user>|<session>". Only used to
// pick that account's data on this device; the server checks the token itself.
export function userIdOf(token: string | null): string | null {
  try {
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const { sub } = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))) as { sub?: string };
    return sub?.split("|")[0] || null;
  } catch {
    return null;
  }
}
