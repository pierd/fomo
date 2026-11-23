export function normalizeTag(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/^#/, "");
}
