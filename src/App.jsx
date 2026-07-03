import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { getWallpaper, searchWallpapers } from "./lib/wallhaven";
import { loadJson, saveJson } from "./lib/storage";
import {
  alertSvg,
  chevronLeftSvg,
  chevronRightSvg,
  closeSvg,
  downloadSvg,
  heartOutlineSvg,
  heartSvg,
  infoSvg,
  linkSvg,
  searchSvg,
  shareSvg,
  spinnerSvg,
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

// Two close ratios give the masonry grid a gentle brick rhythm without the
// jarring, chaotic heights a wide random spread produces.
const SKELETON_RATIOS = [0.82, 0.94];

function SkeletonCard({ index = 0 }) {
  const ratio = SKELETON_RATIOS[index % SKELETON_RATIOS.length];
  const delay = `${(index % 4) * 90}ms`;
  return (
    <div className="card skeletonCard" aria-hidden="true">
      <div
        className="skeleton"
        style={{ aspectRatio: `${ratio}`, width: "100%", animationDelay: delay }}
      />
    </div>
  );
}

function SkeletonRow({ count = 8, keyPrefix = "sk" }) {
  return Array.from({ length: count }, (_, i) => (
    <SkeletonCard index={i} key={`${keyPrefix}-${i}`} />
  ));
}

function WallpaperCard({ item, fav, onOpen, onToggleFav, priority }) {
  const [loaded, setLoaded] = useState(false);
  const resLabel = item.resolution || `${item.dimension_x}x${item.dimension_y}`;
  const small = item.thumbs?.small || item.thumbs?.large;
  const large = item.thumbs?.large || item.thumbs?.small;
  const ratio =
    item.dimension_x && item.dimension_y
      ? `${item.dimension_x} / ${item.dimension_y}`
      : "4 / 5";

  return (
    <div className="card">
      <button
        type="button"
        className="cardOpen"
        onClick={() => onOpen(item)}
        title="Open"
      >
        <div className={`thumbWrap ${loaded ? "loaded" : ""}`} style={{ aspectRatio: ratio }}>
          {!loaded ? <div className="skeleton thumbSkeleton" /> : null}
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
            fetchPriority={priority ? "high" : "low"}
            onLoad={() => setLoaded(true)}
          />
        </div>
      </button>
      <div className="cardBar">
        <div className="chip">{resLabel}</div>
        <button
          type="button"
          className={`heart ${fav ? "on" : ""}`}
          onClick={() => onToggleFav(item.id, item)}
          title={fav ? "Unfavorite" : "Favorite"}
          dangerouslySetInnerHTML={{ __html: heartSvg({ filled: fav }) }}
        />
      </div>
    </div>
  );
}

function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="emptyState">
      <div className="emptyIcon" dangerouslySetInnerHTML={{ __html: icon }} />
      <div className="emptyTitle">{title}</div>
      {subtitle ? <div className="emptySubtitle">{subtitle}</div> : null}
      {action ? <div className="emptyAction">{action}</div> : null}
    </div>
  );
}

function Modal({
  open,
  onClose,
  item,
  isFav,
  onToggleFav,
  onSearchTag,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const touchRef = useRef(null);

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  };

  const handleTouchEnd = (e) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.time;
    // Ignore slow drags, tiny movements, and mostly-vertical gestures so this
    // doesn't fight with pinch/scroll gestures on the image itself.
    if (dt > 600 || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0) onPrev?.();
    else onNext?.();
  };

  useEffect(() => {
    if (!open || !item?.id) return;
    let alive = true;
    setLoading(true);
    setErr("");
    setDetails(null);
    setToast("");
    setHeroLoaded(false);
    setHeroFailed(false);
    setCandidateIndex(0);
    setInfoOpen(false);
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
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onPrev, onNext]);

  // Keep the page underneath from scrolling while the fullscreen viewer is up.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || !item) return null;

  const d = details || item;
  const pageUrl = `https://commons.wikimedia.org/?curid=${encodeURIComponent(item.id)}`;
  const imgUrl = item.path || d.path;
  // Prefer the grid's already-loaded 900px thumbnail (instant, browser-cached)
  // over the detail endpoint's 2400px render or the raw original file — some
  // Commons originals are huge (tens of MB, occasionally scanned TIFFs), and
  // even the 2400px detail thumb was slow enough to hang the viewer open on
  // a spinner instead of showing the picture instantly.
  const previewUrl = item.thumbs?.large || d.thumbs?.large || d.thumbs?.original;
  // A handful of Commons files have no generated thumbnail at all, so the
  // only candidate is the raw original — which occasionally fails to load
  // (some hosts block it). Try each known URL in turn instead of getting
  // stuck on a spinner if the first one 404s or is blocked.
  const heroCandidates = [
    ...new Set([previewUrl, imgUrl, item.thumbs?.small, d.thumbs?.small].filter(Boolean)),
  ];
  const heroSrc = heroCandidates[candidateIndex];

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

    pushToast("Downloading…");

    // Fetch the bytes and save from a same-origin blob URL. This is the only
    // way to force a real save (no new tab / page navigation) regardless of
    // what headers the remote host sends `download` on a cross-origin <a>
    // is silently ignored by most mobile browsers, which is what made this
    // open the image in a new tab instead of downloading it.
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
      pushToast("Downloaded");
      return;
    } catch {
      // CORS or network failure — fall through to a direct link.
    }

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

    try {
      const a = document.createElement("a");
      a.href = directDownloadUrl;
      a.download = filename;
      // Cross-origin browsers can silently ignore `download` — target a new
      // tab so that worst case, the app itself never navigates away.
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      pushToast("Downloading…");
    } catch {
      // Last resort: let the browser handle it in a new tab.
      window.open(imgUrl, "_blank", "noopener,noreferrer");
    }
  };

  const hasMeta =
    Boolean(d.resolution) ||
    Boolean(d.ratio) ||
    Number.isFinite(d.file_size) ||
    d.views != null ||
    d.favorites != null ||
    Boolean(d.uploader?.username) ||
    Boolean(d._license) ||
    (Array.isArray(d.tags) && d.tags.length > 0);

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* A single fullscreen, non-scrolling stage: the image is always fully
          visible with no page scroll. Metadata is opt-in via the info sheet
          so it never forces the primary view to scroll. */}
      <div className="viewer" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {hasPrev ? (
          <button
            type="button"
            className="viewerNav viewerNavPrev"
            title="Previous"
            aria-label="Previous wallpaper"
            onClick={onPrev}
            dangerouslySetInnerHTML={{ __html: chevronLeftSvg() }}
          />
        ) : null}
        {hasNext ? (
          <button
            type="button"
            className="viewerNav viewerNavNext"
            title="Next"
            aria-label="Next wallpaper"
            onClick={onNext}
            dangerouslySetInnerHTML={{ __html: chevronRightSvg() }}
          />
        ) : null}
        <div className="viewerStage">
          {heroFailed ? (
            <div className="viewerImgError">
              <div
                className="emptyIcon"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: alertSvg() }}
              />
              <div>Preview unavailable</div>
              <a
                className="btn ghost"
                href={imgUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original
              </a>
            </div>
          ) : (
            <>
              {!heroLoaded ? <div className="skeleton viewerImgSkeleton" /> : null}
              {heroSrc ? (
                <img
                  key={heroSrc}
                  className={`viewerImg ${heroLoaded ? "loaded" : ""}`}
                  src={heroSrc}
                  alt="Wallpaper preview"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => setHeroLoaded(true)}
                  onError={() => {
                    if (candidateIndex < heroCandidates.length - 1) {
                      setCandidateIndex((i) => i + 1);
                    } else {
                      setHeroFailed(true);
                    }
                  }}
                />
              ) : null}
            </>
          )}
        </div>

        <div className="viewerTopBar">
          <div className="viewerTitle">
            <div className="viewerTitleMain">
              {safeText(d.resolution || "Wallpaper")}{" "}
              <span className="viewerId">#{item.id}</span>
            </div>
            <div className="subtitle" style={{ marginTop: 2 }}>
              {toast ? (
                toast
              ) : loading ? (
                <span className="inlineLoading">
                  <span
                    className="spin"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: spinnerSvg() }}
                  />
                  Loading details…
                </span>
              ) : err ? (
                err
              ) : (
                safeText(d.source || "")
              )}
            </div>
          </div>
          <IconButton title="Close" onClick={onClose} svg={closeSvg()} />
        </div>

        <div className="viewerBottomBar">
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
          <button
            type="button"
            className={`iconBtn ${infoOpen ? "on" : ""}`}
            title={infoOpen ? "Hide details" : "Show details"}
            aria-label={infoOpen ? "Hide details" : "Show details"}
            aria-pressed={infoOpen}
            onClick={() => setInfoOpen((v) => !v)}
            dangerouslySetInnerHTML={{ __html: infoSvg() }}
          />
        </div>

        {infoOpen ? (
          <div className="infoSheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="infoSheetHandle" aria-hidden="true" />
            {!hasMeta && !loading ? (
              <div className="hint">No details available.</div>
            ) : (
              <>
                <div className="metaGrid">
                  <div className="kv">
                    <div className="k">Resolution</div>
                    <div className="v">
                      {d.resolution ? safeText(d.resolution) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">Ratio</div>
                    <div className="v">
                      {d.ratio ? safeText(d.ratio) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">Size</div>
                    <div className="v">
                      {Number.isFinite(d.file_size) ? bytesToMb(d.file_size) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">Views</div>
                    <div className="v">
                      {d.views != null ? safeText(d.views) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">Favorites</div>
                    <div className="v">
                      {d.favorites != null ? safeText(d.favorites) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">Uploader</div>
                    <div className="v">
                      {d.uploader?.username ? safeText(d.uploader.username) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                  <div className="kv">
                    <div className="k">License</div>
                    <div className="v">
                      {d._license ? safeText(d._license) : loading ? (
                        <span className="skeleton textSkeleton" />
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="hint" style={{ marginBottom: 8 }}>
                      Tags
                    </div>
                    <div className="tags">
                      {Array.from({ length: 6 }, (_, i) => (
                        <span
                          className="skeleton tagSkeleton"
                          key={i}
                          style={{ width: 40 + ((i * 17) % 46) }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {!loading && Array.isArray(d.tags) && d.tags.length > 0 ? (
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
              </>
            )}
          </div>
        ) : null}
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
  // Default to "random" so a fresh load (or a plain refresh) surfaces a new
  // set of wallpapers instead of the same deterministic "top" ranking.
  const [sorting, setSorting] = useState(() => {
    const s = savedPrefs?.sorting;
    return s === "relevance" || s === "latest" || s === "random" ? s : "random";
  });

  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);

  const [favStore, setFavStore] = useState(() =>
    normalizeFavStore(loadJson(LS_KEY, { ids: [], cache: {} })),
  );
  const favs = useMemo(() => new Set(favStore.ids), [favStore.ids]);

  const params = useMemo(() => {
    const q = clampLen(appliedQuery, 220);

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
  }, [appliedQuery, sorting]);

  useEffect(() => {
    saveJson(LS_PREFS, {
      q: appliedQuery,
      view,
      sorting,
      atleast,
      ratios,
    });
  }, [appliedQuery, view, sorting, atleast, ratios]);

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
    setItems([]);
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
  const shownList = view === "favorites" ? effectiveItems : browseShown;

  const activeIndex = active
    ? shownList.findIndex((x) => String(x.id) === String(active.id))
    : -1;
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < shownList.length - 1;
  const goPrev = () => {
    if (hasPrev) setActive(shownList[activeIndex - 1]);
  };
  const goNext = () => {
    if (hasNext) setActive(shownList[activeIndex + 1]);
  };

  const isInitialLoading = view === "browse" && loading && items.length === 0;
  const isPaginating = view === "browse" && loading && items.length > 0;
  const initialError = view === "browse" && Boolean(err) && items.length === 0;
  const noResults = view === "browse" && !loading && !err && browseShown.length === 0;
  const noFavorites = view === "favorites" && favs.size === 0;

  return (
    <div className="app">
      <div
        className={`topProgress ${loading || refreshing ? "on" : ""}`}
        aria-hidden="true"
      />
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
        </section>

        <div className="statusRow">
          <div className="status">
            {err ? (
              <span className="statusError">
                <span
                  className="statusIcon"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: alertSvg() }}
                />
                {err}
              </span>
            ) : loading ? (
              <span className="inlineLoading">
                <span
                  className="spin"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: spinnerSvg() }}
                />
                Loading…
              </span>
            ) : view === "favorites" ? (
              `${favs.size} favorite${favs.size === 1 ? "" : "s"}`
            ) : (
              `${browseShown.length} shown · page ${page}`
            )}
          </div>
          {view === "favorites" ? (
            <div className="status">
              {missingFavIds.length
                ? `Loading ${Math.min(missingFavIds.length, 6)}…`
                : `${effectiveItems.length} shown`}
            </div>
          ) : !loading && !hasMore && browseShown.length > 0 ? (
            <div className="status">End</div>
          ) : null}
        </div>

        <div className="gridWrap">
          {isInitialLoading ? (
            <div className="masonry" aria-label="Loading wallpapers">
              <SkeletonRow count={10} keyPrefix="init" />
            </div>
          ) : initialError ? (
            <EmptyState
              icon={alertSvg()}
              title="Couldn't load wallpapers"
              subtitle={err}
              action={
                <button
                  type="button"
                  className="btn"
                  onClick={() => reload(undefined, { scroll: false })}
                >
                  Retry
                </button>
              }
            />
          ) : noResults ? (
            <EmptyState
              icon={searchSvg()}
              title="No wallpapers found"
              subtitle="Try a different search term or loosen your filters."
              action={
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setQuery("");
                    setAppliedQuery("");
                    setAtleast("");
                    setRatios("");
                  }}
                >
                  Clear filters
                </button>
              }
            />
          ) : noFavorites ? (
            <EmptyState
              icon={heartOutlineSvg()}
              title="No favorites yet"
              subtitle="Tap the heart on any wallpaper to save it here."
              action={
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setView("browse");
                    scrollToTop({ smooth: true });
                  }}
                >
                  Browse wallpapers
                </button>
              }
            />
          ) : (
            <div className="masonry" aria-label="Wallpapers">
              {shownList.map((it, idx) => (
                <WallpaperCard
                  key={it.id}
                  item={it}
                  fav={favs.has(String(it.id))}
                  onOpen={onOpen}
                  onToggleFav={toggleFav}
                  priority={idx < 2}
                />
              ))}

              {view === "favorites" && missingFavIds.length
                ? missingFavIds.slice(0, 6).map((id) => (
                    <div className="card" key={`missing-${id}`} aria-label="Loading favorite">
                      <div className="skeleton thumbSkeleton" style={{ aspectRatio: "4 / 5" }} />
                      <div className="cardBar">
                        <div className="chip">
                          <span
                            className="spin"
                            aria-hidden="true"
                            dangerouslySetInnerHTML={{ __html: spinnerSvg() }}
                          />
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
                : null}

              {isPaginating ? <SkeletonRow count={4} keyPrefix="more" /> : null}
            </div>
          )}

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
        onPrev={goPrev}
        onNext={goNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />
    </div>
  );
}
