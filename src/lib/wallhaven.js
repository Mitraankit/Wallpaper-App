// Switched from Wallhaven -> Wikimedia Commons (no API key, huge catalog).
//
// MediaWiki Action API requires `origin=*` for anonymous CORS requests.
// Ref: https://www.mediawiki.org/wiki/API:Cross-site_requests
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const LIMIT = 24;

function commonsUrl(params) {
  const url = new URL(COMMONS_API);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("origin", "*");
  return url.toString();
}

function pageToItem(page) {
  const ii = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
  const w = Number(ii?.width) || 0;
  const h = Number(ii?.height) || 0;
  const resolution = w && h ? `${w}x${h}` : "";
  const thumbLarge =
    ii?.thumburl || ii?.url || page?.thumbnail?.source || undefined;
  const thumbSmall =
    page?.thumbnail?.source ||
    ii?.thumburl ||
    ii?.url ||
    undefined;

  return {
    id: String(page.pageid),
    // Wallhaven-like shape expected by the UI:
    dimension_x: w,
    dimension_y: h,
    resolution,
    ratio: w && h ? String((w / h).toFixed(4)) : "",
    file_size: Number(ii?.size) || undefined,
    views: undefined,
    favorites: undefined,
    uploader: ii?.user ? { username: ii.user } : undefined,
    created_at: ii?.timestamp || undefined,
    source: page?.canonicalurl || (page?.pageid ? `https://commons.wikimedia.org/?curid=${page.pageid}` : ""),
    path: ii?.url,
    thumbs: {
      large: thumbLarge,
      small: thumbSmall,
      original: ii?.url,
    },
    // Keep title for later details.
    _title: page?.title,
  };
}

export async function searchWallpapers({ q, page = 1, offset, sort } = {}) {
  const query = (q || "").trim() || "wallpaper";
  const gsrOffset =
    offset == null ? Math.max(0, (Number(page) - 1) * LIMIT) : Number(offset);

  const url = commonsUrl({
    action: "query",
    format: "json",
    formatversion: 2,
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: 6, // File:
    gsrlimit: LIMIT,
    gsroffset: Number.isFinite(gsrOffset) ? gsrOffset : undefined,
    gsrsort: sort || undefined,
    prop: "imageinfo|info|pageimages",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: 640,
    iiprop: "url|size|mime|user|timestamp|extmetadata",
    iiurlwidth: 1200,
  });

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Commons search failed (${res.status}) ${text}`.trim());
  }
  const json = await res.json();
  const pages = json?.query?.pages || [];
  const data = Array.isArray(pages) ? pages.map(pageToItem) : [];
  const nextOffset = json?.continue?.gsroffset ?? null;
  const hasMore = nextOffset != null;

  return {
    data,
    meta: {
      current_page: Number(page),
      next_offset: nextOffset,
      has_more: hasMore,
      total: undefined,
    },
  };
}

export async function getWallpaper(id) {
  const pageid = Number(id);
  if (!Number.isFinite(pageid)) throw new Error("Invalid wallpaper id");

  const url = commonsUrl({
    action: "query",
    format: "json",
    formatversion: 2,
    pageids: pageid,
    prop: "imageinfo|info|categories",
    inprop: "url",
    cllimit: 24,
    clshow: "!hidden",
    iiprop: "url|size|mime|user|timestamp|extmetadata",
    iiurlwidth: 2400,
  });

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Commons details failed (${res.status}) ${text}`.trim());
  }
  const json = await res.json();
  const page = Array.isArray(json?.query?.pages) ? json.query.pages[0] : null;
  if (!page || page.missing) throw new Error("Wallpaper not found");
  const item = pageToItem(page);

  const ii = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
  const meta = ii?.extmetadata || {};
  const uploader = meta?.Artist?.value
    ? { username: String(meta.Artist.value).replace(/<[^>]*>/g, "") }
    : item.uploader;

  const categories = Array.isArray(page?.categories) ? page.categories : [];
  const tags = categories
    .map((c) => String(c?.title || ""))
    .filter(Boolean)
    .map((t) => t.replace(/^Category:/, ""))
    .slice(0, 22)
    .map((name) => ({ id: name, name }));

  const license =
    meta?.LicenseShortName?.value ||
    meta?.License?.value ||
    meta?.UsageTerms?.value ||
    "";

  const source = page?.canonicalurl || `https://commons.wikimedia.org/?curid=${pageid}`;

  return {
    data: {
      ...item,
      uploader,
      source,
      tags,
      _license: String(license).replace(/<[^>]*>/g, ""),
    },
  };
}
