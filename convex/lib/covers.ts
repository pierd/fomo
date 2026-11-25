// Finding and downloading cover images, without API keys: the item's source
// page (Goodreads, Letterboxd...), Open Library for books, Wikipedia otherwise.

const USER_AGENT = "fomo/1.0 (https://fomo.lessismore.studio)";
const MAX_BYTES = 5 * 1024 * 1024;

export type CoverHints = {
  title: string;
  creator?: string;
  year?: number;
  kind?: string;
  isbn?: string;
  wikipediaTitle?: string;
  sourceUrl?: string;
};

async function get(url: string, accept = "*/*") {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    redirect: "follow",
    // One stuck site must not hold up the rest of a batch.
    signal: AbortSignal.timeout(15_000),
  });
  return res;
}

async function ogImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await get(pageUrl, "text/html");
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300_000);
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return null;
    const url = m[1].replace(/&amp;/g, "&");
    // Generic site images rather than a cover.
    if (/nophoto|no-cover|default|logo|placeholder|empty-poster/i.test(url)) return null;
    return new URL(url, pageUrl).toString();
  } catch {
    return null;
  }
}

async function openLibrary(h: CoverHints): Promise<string | null> {
  try {
    if (h.isbn) {
      const isbn = h.isbn.replace(/[^0-9X]/gi, "");
      if (isbn.length >= 10) {
        const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
        const res = await get(url);
        if (res.ok) return url;
      }
    }
    const params = new URLSearchParams({ title: h.title, limit: "3", fields: "cover_i" });
    if (h.creator) params.set("author", h.creator);
    const res = await get(`https://openlibrary.org/search.json?${params}`, "application/json");
    if (!res.ok) return null;
    const data = (await res.json()) as { docs?: { cover_i?: number }[] };
    const cover = data.docs?.find((d) => d.cover_i)?.cover_i;
    return cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : null;
  } catch {
    return null;
  }
}

async function wikipedia(h: CoverHints): Promise<string | null> {
  const queries: string[] = [];
  if (h.wikipediaTitle) queries.push(h.wikipediaTitle);
  const kindWord =
    h.kind === "movie" ? "film" : h.kind === "series" ? "TV series" : h.kind === "game" ? "video game" : h.kind ?? "";
  queries.push([h.title, h.year, kindWord, h.creator].filter(Boolean).join(" "));
  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        generator: "search",
        gsrsearch: q,
        gsrlimit: "1",
        prop: "pageimages",
        piprop: "original",
        // Posters and box art are non-free images, hidden by default.
        pilicense: "any",
        origin: "*",
      });
      const res = await get(`https://en.wikipedia.org/w/api.php?${params}`, "application/json");
      if (!res.ok) continue;
      const data = (await res.json()) as {
        query?: { pages?: Record<string, { original?: { source: string } }> };
      };
      const page = Object.values(data.query?.pages ?? {})[0];
      const src = page?.original?.source;
      if (src && !/\.svg$/i.test(src)) return src;
    } catch {
      // Try the next query.
    }
  }
  return null;
}

export async function findCoverUrl(h: CoverHints): Promise<string | null> {
  if (h.sourceUrl) {
    const fromSource = await ogImage(h.sourceUrl);
    if (fromSource) return fromSource;
  }
  const isBook = h.kind === "book" || h.isbn !== undefined;
  if (isBook) {
    const ol = await openLibrary(h);
    if (ol) return ol;
  }
  return await wikipedia(h);
}

export async function downloadImage(url: string): Promise<Blob | null> {
  try {
    const res = await get(url, "image/*");
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    // Open Library serves a 1x1 gif for some missing covers.
    if (buf.byteLength < 1000 || buf.byteLength > MAX_BYTES) return null;
    return new Blob([buf], { type });
  } catch {
    return null;
  }
}
