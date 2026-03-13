import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { getWallpaper, searchWallpapers } from "./lib/wallhaven";
import { loadJson, saveJson } from "./lib/storage";
import {
  closeSvg,
  downloadSvg,
  heartSvg,
  linkSvg,
  shareSvg,
  wallpaperSvg,
} from "./lib/icons";

const LS_KEY = "wallpaper-app:favs";
const LS_PREFS = "wallpaper-app:prefs";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function useIntersection(callback) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) callback();
      },
      { root: null, rootMargin: "800px 0px", threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [callback]);
  return ref;
}

function buildCategories({ general, nature, people }) {
  return `${general ? "1" : "0"}${nature ? "1" : "0"}${people ? "1" : "0"}`;
}

function bytesToMb(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeFavStore(raw) {
  if (Array.isArray(raw)) {
    return { ids: raw.map((x) => String(x)), cache: {} };
  }
  if (!raw || typeof raw !== "object") return { ids: [], cache: {} };
  const ids = Array.isArray(raw.ids) ? raw.ids.map((x) => String(x)) : [];
  const cacheIn = raw.cache && typeof raw.cache === "object" ? raw.cache : {};
  const cache = {};
  for (const [k, v] of Object.entries(cacheIn)) cache[String(k)] = v;
  return { ids, cache };
}

function clampLen(s, max) {
  const str = String(s ?? "");
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function safeText(s) {
  return String(s ?? "");
}

function scrollToTop({ smooth = false } = {}) {
  try {
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  } catch {
    // ignore
  }
}

function IconButton({ title, onClick, svg, href, download, disabled }) {
  const common = {
    className: "iconBtn",
    title,
    "aria-label": title,
    dangerouslySetInnerHTML: { __html: svg },
  };

  if (href) {
    return (
      <a
        {...common}
        href={href}
        onClick={disabled ? (e) => e.preventDefault() : undefined}
        style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
        download={download}
        target="_blank"
        rel="noopener noreferrer"
      />
    );
  }

  return (
    <button
      type="button"
      {...common}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    />
  );
}

function Modal({ open, onClose, item, isFav, onToggleFav, onSearchTag }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!open || !item?.id) return;
    let alive = true;
    setLoading(true);
    setErr("");
    setDetails(null);
    setToast("");
    getWallpaper(item.id)
      .then((d) => {
        if (!alive) return;
        setDetails(d?.data || null);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e?.message || "Failed to load details.");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, item?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !item) return null;

  const d = details || item;
  const pageUrl = `https://commons.wikimedia.org/?curid=${encodeURIComponent(item.id)}`;
  const imgUrl = item.path || d.path;
  const previewUrl = d.thumbs?.original || d.thumbs?.large || item.thumbs?.large;

  const pushToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1400);
  };

  const doCopyLink = async () => {
    // Users usually want the direct image link; fall back to the Commons page.
    const link = imgUrl || pageUrl;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        pushToast("Copied");
        return;
      }
    } catch {
      // fall through
    }
    // Fallback for non-secure contexts / blocked clipboard.
    window.prompt("Copy link:", link);
  };

  const doShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: `Wallpaper ${item.id}`,
        text: "Wallpaper",
        url: pageUrl,
      });
    } catch {
      // ignore
    }
  };

  const doDownload = async () => {
    if (!imgUrl) return;
    const nameBase = d._title
      ? String(d._title).replace(/^File:/, "").replace(/[^\w.\-() ]+/g, "_")
      : `wallpaper-${item.id}.jpg`;
    const filename = nameBase.length > 3 ? nameBase : `wallpaper-${item.id}.jpg`;

    // Prefer a URL that sets Content-Disposition: attachment (Commons often honors `?download`).
    const commonsFileName = d._title
      ? String(d._title).replace(/^File:/, "").trim()
      : item._title
        ? String(item._title).replace(/^File:/, "").trim()
        : "";
    const directDownloadUrl = commonsFileName
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
          commonsFileName,
        )}?download=1`
      : imgUrl;

    // First try a direct download via navigation. This preserves the click user-gesture
    // (important on mobile Safari/Chrome), and avoids CORS limitations.
    try {
      const a = document.createElement("a");
      a.href = directDownloadUrl;
      a.download = filename;
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      pushToast("Downloading…");
      return;
    } catch {
      // fall through
    }

    try {
      const res = await fetch(imgUrl, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      pushToast("Downloading…");
    } catch {
      // Fallback: let the browser handle it (may open in a new tab).
      window.open(imgUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalTop">
          <div>
            <div className="modalTitle">
              {safeText(d.resolution || "Wallpaper")}{" "}
              <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>
                #{item.id}
              </span>
            </div>
            <div className="subtitle" style={{ marginTop: 2 }}>
              {toast
                ? toast
                : loading
                  ? "Loading details…"
                  : err
                    ? err
                    : safeText(d.source || "")}
            </div>
          </div>
          <div className="modalBtns">
            <IconButton
              title={isFav ? "Unfavorite" : "Favorite"}
              onClick={() => onToggleFav(item.id, details || item)}
              svg={heartSvg({ filled: isFav })}
            />
            <IconButton title="Copy image link" onClick={doCopyLink} svg={linkSvg()} />
            <IconButton
              title="Share"
              onClick={doShare}
              svg={shareSvg()}
              disabled={!navigator.share}
            />
            <IconButton
              title="Download"
              onClick={doDownload}
              svg={downloadSvg()}
              disabled={!imgUrl}
            />
            <IconButton title="Close" onClick={onClose} svg={closeSvg()} />
          </div>
        </div>

        <div className="modalBody">
          <div>
            <img
              className="heroImg"
              src={previewUrl || imgUrl}
              alt="Wallpaper preview"
              loading="lazy"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <div>
            <div className="metaGrid">
              <div className="kv">
                <div className="k">Resolution</div>
                <div className="v">{safeText(d.resolution || "--")}</div>
              </div>
              <div className="kv">
                <div className="k">Ratio</div>
                <div className="v">{safeText(d.ratio || "--")}</div>
              </div>
              <div className="kv">
                <div className="k">Size</div>
                <div className="v">{bytesToMb(d.file_size)}</div>
              </div>
              <div className="kv">
                <div className="k">Views</div>
                <div className="v">{safeText(d.views ?? "--")}</div>
              </div>
              <div className="kv">
                <div className="k">Favorites</div>
                <div className="v">{safeText(d.favorites ?? "--")}</div>
              </div>
              <div className="kv">
                <div className="k">Uploader</div>
                <div className="v">{safeText(d.uploader?.username || "--")}</div>
              </div>
              <div className="kv">
                <div className="k">License</div>
                <div className="v">{safeText(d._license || "--")}</div>
              </div>
            </div>

            {Array.isArray(d.tags) && d.tags.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <div className="hint" style={{ marginBottom: 8 }}>
                  Tags
                </div>
                <div className="tags">
                  {d.tags.slice(0, 22).map((t) => (
                    <button
                      className="tag"
                      type="button"
                      key={t.id}
                      onClick={() => onSearchTag(t.name)}
                      title={`Search: ${t.name}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const savedPrefs = useMemo(() => loadJson(LS_PREFS, null), []);
  const [query, setQuery] = useState(savedPrefs?.q ?? "");
  const [appliedQuery, setAppliedQuery] = useState(savedPrefs?.q ?? "");
  const [view, setView] = useState(savedPrefs?.view ?? "browse"); // browse | favorites
  const [atleast, setAtleast] = useState(savedPrefs?.atleast ?? "");
  const [ratios, setRatios] = useState(savedPrefs?.ratios ?? "");
  const [cats, setCats] = useState(
    (() => {
      const c = savedPrefs?.cats;
      if (c && typeof c === "object") {
        // Back-compat: old config used `anime`; map it to `nature`.
        const nature =
          typeof c.nature === "boolean" ? c.nature : Boolean(c.anime);
        return {
          general: typeof c.general === "boolean" ? c.general : true,
          nature,
          people: typeof c.people === "boolean" ? c.people : true,
        };
      }
      return { general: true, nature: true, people: true };
    })(),
  );
  const [sorting, setSorting] = useState(() => {
    const s = savedPrefs?.sorting;
    return s === "relevance" || s === "latest" || s === "random" ? s : "relevance";
  });

  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);

  const [favStore, setFavStore] = useState(() =>
    normalizeFavStore(loadJson(LS_KEY, { ids: [], cache: {} })),
  );
  const favs = useMemo(() => new Set(favStore.ids), [favStore.ids]);

  const params = useMemo(() => {
    const topicBits = buildCategories(cats);
    const topic =
      topicBits === "111"
        ? ""
        : topicBits === "010"
          ? " nature landscape"
        : topicBits === "001"
          ? " portrait"
          : topicBits === "011"
            ? " nature portrait"
            : topicBits === "110"
              ? " nature landscape"
              : topicBits === "101"
                ? " portrait"
                : "";
    const q = clampLen(appliedQuery, 220) + topic;

    const sort =
      sorting === "latest"
        ? "last_edit_desc"
        : sorting === "random"
          ? "random"
          : undefined; // relevance
    return {
      q,
      sort,
    };
  }, [appliedQuery, cats, sorting]);

  useEffect(() => {
    saveJson(LS_PREFS, {
      q: appliedQuery,
      view,
      sorting,
      atleast,
      ratios,
      cats,
    });
  }, [appliedQuery, view, sorting, atleast, ratios, cats]);

  const fetchPage = async (
    nextPage,
    { append, overrideParams, offset, mode = "replace", silent = false } = {},
  ) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    if (!silent) setErr("");
    try {
      const res = await searchWallpapers({
        ...(overrideParams || params),
        page: nextPage,
        offset,
      });
      const rawData = Array.isArray(res?.data) ? res.data : [];
      // Defensive de-dupe: Commons search can occasionally return repeated items.
      const data = (() => {
        const seen = new Set();
        const out = [];
        for (const it of rawData) {
          const id = it?.id == null ? null : String(it.id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push({ ...it, id });
        }
        return out;
      })();
      const m = res?.meta || null;
      startTransition(() => {
        setItems((prev) => {
          const prevList = Array.isArray(prev) ? prev : [];
          const prevSeen = new Set(prevList.map((x) => String(x?.id ?? "")));
          const add = data.filter((x) => !prevSeen.has(String(x.id)));

          if (mode === "appendUnique") {
            return add.length ? [...prevList, ...add] : prevList;
          }
          return append ? [...prevList, ...add] : data;
        });
        if (mode !== "appendUnique") {
          setPage(nextPage);
          setNextOffset(m?.next_offset ?? null);
          setHasMore(Boolean(m?.has_more));
        }
      });

      // Keep a tiny cache for favorites so "Favorites" works after reload.
      if (data.length) {
        setFavStore((prev) => {
          const ids = Array.isArray(prev?.ids) ? prev.ids : [];
          const cache = prev?.cache && typeof prev.cache === "object" ? prev.cache : {};
          const nextCache = { ...cache };
          for (const it of data) {
            if (ids.includes(it.id)) nextCache[it.id] = it;
          }
          const next = { ids, cache: nextCache };
          saveJson(LS_KEY, next);
          return next;
        });
      }
    } catch (e) {
      if (!silent) setErr(e?.message || "Fetch failed.");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  const reload = (override, { scroll = true, smooth = false } = {}) => {
    if (scroll) scrollToTop({ smooth });
    setNextOffset(null);
    setHasMore(true);
    fetchPage(1, { append: false, overrideParams: override, offset: null });
  };

  useEffect(() => {
    if (view !== "browse") return;
    reload(undefined, { scroll: true, smooth: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, params.sort, params.q]);

  const sentinelRef = useIntersection(() => {
    if (view !== "browse") return;
    if (loading) return;
    if (!hasMore) return;
    fetchPage(page + 1, { append: true, offset: nextOffset });
  });

  const refreshAppend = () => {
    if (view !== "browse") return;
    if (loading || refreshing) return;
    fetchPage(1, { append: true, mode: "appendUnique", offset: null, silent: true });
  };

  const toggleFav = (id, item) => {
    const key = String(id);
    setFavStore((prev) => {
      const norm = normalizeFavStore(prev);
      const ids = new Set(norm.ids);
      const cache = norm.cache;
      if (ids.has(key)) {
        ids.delete(key);
      } else {
        ids.add(key);
      }
      const nextCache = { ...cache };
      if (item && typeof item === "object") {
        nextCache[key] = item;
      }
      const next = { ids: [...ids], cache: nextCache };
      saveJson(LS_KEY, next);
      return next;
    });
  };

  const favCount = favs.size;

  const onOpen = (it) => {
    setActive(it);
    setOpen(true);
  };

  const onSearchTag = (tag) => {
    setView("browse");
    setQuery(tag);
    setAppliedQuery(tag);
    scrollToTop({ smooth: true });
    setOpen(false);
  };

  const effectiveItems =
    view === "favorites"
      ? [...favs].map((id) => favStore.cache[id]).filter(Boolean)
      : items;

  const missingFavIds = useMemo(() => {
    if (view !== "favorites") return [];
    const ids = Array.isArray(favStore?.ids) ? favStore.ids : [];
    const cache = favStore?.cache && typeof favStore.cache === "object" ? favStore.cache : {};
    return ids.filter((id) => !cache[id]);
  }, [view, favStore]);

  useEffect(() => {
    if (view !== "favorites") return;
    const ids = Array.isArray(favStore.ids) ? favStore.ids : [];
    const cache = favStore.cache && typeof favStore.cache === "object" ? favStore.cache : {};
    const missing = ids.filter((id) => !cache[id]).slice(0, 6);
    if (!missing.length) return;
    let alive = true;
    Promise.all(
      missing.map((id) =>
        getWallpaper(id)
          .then((r) => r?.data || null)
          .catch(() => null),
      ),
    ).then((details) => {
      if (!alive) return;
      const nextCache = { ...cache };
      for (const d of details) {
        if (d?.id) nextCache[d.id] = d;
      }
      const next = { ids, cache: nextCache };
      setFavStore(next);
      saveJson(LS_KEY, next);
    });
    return () => {
      alive = false;
    };
  }, [view, favStore]);

  // Ensure we have card data for favorites view: keep the last browse list around.
  useEffect(() => {
    if (items.length) return;
    // Prime with an initial browse request so Favorites has thumbnails after a reload.
    fetchPage(1, { append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function filterLocal(list) {
    let out = list;
    const a = String(atleast || "").trim();
    if (a) {
      const m = a.match(/^(\d+)\s*[xX]\s*(\d+)$/);
      if (m) {
        const minW = Number(m[1]);
        const minH = Number(m[2]);
        if (Number.isFinite(minW) && Number.isFinite(minH)) {
          out = out.filter(
            (it) => (it.dimension_x || 0) >= minW && (it.dimension_y || 0) >= minH,
          );
        }
      }
    }
    const r = String(ratios || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (r.length) {
      const targets = r
        .map((t) => {
          const mm = t.match(/^(\d+)\s*[xX]\s*(\d+)$/);
          if (!mm) return null;
          const w = Number(mm[1]);
          const h = Number(mm[2]);
          if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
          return w / h;
        })
        .filter(Boolean);
      if (targets.length) {
        out = out.filter((it) => {
          const w = Number(it.dimension_x) || 0;
          const h = Number(it.dimension_y) || 0;
          if (!w || !h) return true;
          const rr = w / h;
          return targets.some((t) => Math.abs(rr - t) <= 0.06);
        });
      }
    }
    return out;
  }

  const browseShown = useMemo(() => filterLocal(items), [items, atleast, ratios]);

  return (
    <div className="app">
      <div className="bg" aria-hidden="true">
        <div className="grain" />
        <div className="blob blobA" />
        <div className="blob blobB" />
        <div className="gridlines" />
      </div>
      <header className="topbar">
        <div className="topbarInner">
          <div className="brandRow">
            <div className="brand">
              <div
                className="logo"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: wallpaperSvg() }}
              />
              <div>
                <div className="title">Wallpapers</div>
                <div className="subtitle">Wikimedia Commons</div>
              </div>
            </div>
            <div className="actions">
              <button
                className={`pill ${view === "browse" ? "on" : ""}`}
                type="button"
                onClick={() => {
                  setView("browse");
                  scrollToTop({ smooth: true });
                }}
              >
                Browse
              </button>
              <button
                className={`pill ${view === "favorites" ? "on" : ""}`}
                type="button"
                onClick={() => {
                  setView("favorites");
                  scrollToTop({ smooth: true });
                }}
                title="Favorites stored locally"
              >
                Favorites ({favCount})
              </button>
              <button
                className={`pill ${refreshing ? "on" : ""}`}
                type="button"
                onClick={refreshAppend}
                disabled={view !== "browse" || loading}
                title="Fetch fresh results and add them at the bottom"
                style={
                  view !== "browse" || loading
                    ? { opacity: 0.6, cursor: "not-allowed" }
                    : undefined
                }
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <form
            className="searchRow"
            onSubmit={(e) => {
              e.preventDefault();
              setView("browse");
              setAppliedQuery(query);
              scrollToTop({ smooth: true });
            }}
          >
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search wallpapers…"
              spellCheck={false}
            />
            <button className="btn" type="submit" disabled={loading}>
              Search
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setQuery("");
                setAppliedQuery("");
                setView("browse");
                scrollToTop({ smooth: true });
              }}
              disabled={loading}
            >
              Clear
            </button>
          </form>
        </div>
      </header>

      <main className="content">
        <section className="filters" aria-label="Filters">
          <div className="seg" role="group" aria-label="Quick sorting">
            <button
              type="button"
              className={sorting === "relevance" ? "on" : ""}
              onClick={() => setSorting("relevance")}
            >
              Top
            </button>
            <button
              type="button"
              className={sorting === "latest" ? "on" : ""}
              onClick={() => setSorting("latest")}
            >
              Latest
            </button>
            <button
              type="button"
              className={sorting === "random" ? "on" : ""}
              onClick={() => setSorting("random")}
              title="Shuffle results"
            >
              Random
            </button>
          </div>

          <div className="filtersGrid">
            <div className="field">
              <label>Categories</label>
              <div className="seg" role="group" aria-label="Categories">
                {["general", "nature", "people"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={cats[k] ? "on" : ""}
                    onClick={() =>
                      setCats((p) => ({
                        ...(() => {
                          const next = { ...p, [k]: !p[k] };
                          if (!next.general && !next.nature && !next.people) {
                            next.general = true;
                          }
                          return next;
                        })(),
                      }))
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Min Resolution</label>
              <input
                className="input"
                value={atleast}
                onChange={(e) => setAtleast(e.target.value)}
                placeholder="e.g. 1920x1080"
              />
            </div>

            <div className="field">
              <label>Ratios</label>
              <input
                className="input"
                value={ratios}
                onChange={(e) => setRatios(e.target.value)}
                placeholder="e.g. 16x9,21x9"
              />
            </div>
          </div>
        </section>

        <div className="statusRow">
          <div className="status">
            {err
              ? `Error: ${err}`
              : loading
                ? "Loading…"
                : view === "favorites"
                  ? `${favs.size} favorites`
                  : `${browseShown.length} shown · page ${page}`}
          </div>
          {view === "favorites" ? (
            <div className="status">
              {missingFavIds.length
                ? `Loading ${Math.min(missingFavIds.length, 6)}…`
                : `${effectiveItems.length} shown`}
            </div>
          ) : !hasMore ? (
            <div className="status">End</div>
          ) : null}
        </div>

        <div className="gridWrap">
          <div className="masonry" aria-label="Wallpapers">
            {(view === "favorites" ? effectiveItems : browseShown).map((it, idx) => {
              const fav = favs.has(String(it.id));
              const resLabel = it.resolution || `${it.dimension_x}x${it.dimension_y}`;
              const small = it.thumbs?.small || it.thumbs?.large;
              const large = it.thumbs?.large || it.thumbs?.small;
              return (
                <div className="card" key={it.id}>
                  <button
                    type="button"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "block",
                    }}
                    onClick={() => onOpen(it)}
                    title="Open"
                  >
                    <img
                      className="thumb"
                      src={small}
                      srcSet={
                        small && large && small !== large
                          ? `${small} 420w, ${large} 900w`
                          : undefined
                      }
                      sizes="(min-width: 1020px) 25vw, (min-width: 720px) 33vw, 50vw"
                      alt={resLabel}
                      loading="lazy"
                      decoding="async"
                      fetchPriority={idx < 2 ? "high" : "low"}
                      style={{
                        aspectRatio: `${it.dimension_x} / ${it.dimension_y}`,
                        objectFit: "cover",
                      }}
                    />
                  </button>
                  <div className="cardBar">
                    <div className="chip">{resLabel}</div>
                    <button
                      type="button"
                      className={`heart ${fav ? "on" : ""}`}
                      onClick={() => toggleFav(it.id, it)}
                      title={fav ? "Unfavorite" : "Favorite"}
                      dangerouslySetInnerHTML={{ __html: heartSvg({ filled: fav }) }}
                    />
                  </div>
                </div>
              );
            })}

            {view === "favorites" && missingFavIds.length ? (
              missingFavIds.slice(0, 6).map((id) => (
                <div className="card" key={`missing-${id}`} aria-label="Loading favorite">
                  <div
                    className="thumb"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02))",
                      border: "1px solid rgba(255,255,255,.08)",
                      aspectRatio: "16 / 10",
                    }}
                  />
                  <div className="cardBar">
                    <div className="chip" style={{ opacity: 0.7 }}>
                      Loading…
                    </div>
                    <button
                      type="button"
                      className="heart on"
                      onClick={() => toggleFav(id)}
                      title="Unfavorite"
                      dangerouslySetInnerHTML={{ __html: heartSvg({ filled: true }) }}
                    />
                  </div>
                </div>
              ))
            ) : null}
          </div>

          {view === "browse" ? <div ref={sentinelRef} className="sentinel" /> : null}
        </div>
      </main>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        item={active}
        isFav={active ? favs.has(String(active.id)) : false}
        onToggleFav={toggleFav}
        onSearchTag={onSearchTag}
      />
    </div>
  );
}
