import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getBootstrap, importCsv, loadDemo, markSeen, startRefresh } from "./api";
import type { Bootstrap, FeedPost } from "./types";
import "./styles.css";

type View = "today" | "people" | "history";

const numberFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const diffHours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3_600_000));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Icon({ name }: { name: "heart" | "comment" | "arrow" | "refresh" | "upload" | "check" }) {
  const paths = {
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
    comment: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
    arrow: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    upload: <><path d="M12 16V3" /><path d="m7 8 5-5 5 5" /><path d="M5 14v6h14v-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Skeleton() {
  return (
    <div className="skeleton-list" aria-label="Loading your feed">
      {[0, 1, 2].map((item) => (
        <div className="skeleton-card" key={item}>
          <span className="skeleton-avatar" />
          <div><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line medium" /></div>
        </div>
      ))}
    </div>
  );
}

function FeedCard({ post, onSeen }: { post: FeedPost; onSeen: (id: string) => void }) {
  const cardRef = useRef<HTMLElement>(null);
  const wasVisible = useRef(false);
  const marked = useRef(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || marked.current) return;
        if (entry.isIntersecting) wasVisible.current = true;
        if (wasVisible.current && !entry.isIntersecting && entry.boundingClientRect.bottom < 88) {
          marked.current = true;
          setSeen(true);
          onSeen(post.id);
        }
      },
      { threshold: [0, 0.5], rootMargin: "-76px 0px 0px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onSeen, post.id]);

  return (
    <article className="feed-card" ref={cardRef} data-seen={seen ? "true" : "false"}>
      <div className="card-rail"><span className="avatar" aria-hidden="true">{initials(post.profileName)}</span></div>
      <div className="card-body">
        <header className="card-header">
          <div>
            <a className="person-name" href={post.profileUrl} target="_blank" rel="noreferrer">{post.profileName}</a>
            <span className="post-meta">
              {post.kind !== "original" && <span className="post-kind">{post.kind}</span>}
              <time dateTime={post.publishedAt}>{formatRelativeDate(post.publishedAt)}</time>
            </span>
          </div>
          {seen && <span className="seen-mark"><Icon name="check" /> Read</span>}
        </header>
        <p className="post-copy">{post.content}</p>
        <footer className="card-footer">
          <div className="metrics" aria-label={`${post.likes} reactions and ${post.comments} comments`}>
            <span><Icon name="heart" />{numberFormatter.format(post.likes)}</span>
            <span><Icon name="comment" />{numberFormatter.format(post.comments)}</span>
          </div>
          <a className="open-link" href={post.linkedinUrl} target="_blank" rel="noreferrer">
            Open on LinkedIn <Icon name="arrow" />
          </a>
        </footer>
      </div>
    </article>
  );
}

function EmptyFeed({ hasProfiles, demoMode, onUpload, onDemo }: { hasProfiles: boolean; demoMode: boolean; onUpload: () => void; onDemo: () => void }) {
  return (
    <section className="empty-state">
      <span className="empty-kicker">All clear</span>
      <h2>{hasProfiles ? "Nothing new to read." : "Start with your people."}</h2>
      <p>{hasProfiles ? "Your next refresh will collect anything they publish." : "Upload a CSV with a linkedin_url column. Names are optional."}</p>
      <div className="empty-actions">
        {!hasProfiles && <button className="primary-button" onClick={onUpload}><Icon name="upload" /> Upload CSV</button>}
        {demoMode && <button className="text-button" onClick={onDemo}>Preview sample posts</button>}
      </div>
    </section>
  );
}

function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("today");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionSeen, setSessionSeen] = useState<Set<string>>(() => new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await getBootstrap(signal);
    setData(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // This effect intentionally synchronizes React with the external feed API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(controller.signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setActionError(error instanceof Error ? error.message : "Could not load the feed.");
      setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (data?.refresh.status !== "running" && data?.refresh.status !== "starting") return;
    const timeout = window.setTimeout(() => {
      void reload().catch(() => undefined);
    }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [data?.refresh.status, reload]);

  const handleSeen = useCallback((id: string) => {
    setSessionSeen((current) => new Set(current).add(id));
    void markSeen([id]).catch((error: unknown) => {
      setSessionSeen((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setActionError(error instanceof Error ? error.message : "Could not remember that post.");
    });
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      if (file.size > 512_000) throw new Error("Keep the CSV under 500 KB.");
      const result = await importCsv(await file.text());
      const warning = result.errors.length > 0 ? ` ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} could not be imported.` : "";
      setMessage(`${result.imported} people are now in your reading list.${warning}`);
      await reload();
      setView("people");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The CSV could not be imported.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleDemo() {
    setBusy(true);
    setActionError(null);
    try {
      await loadDemo();
      await reload();
      setView("today");
      setMessage("Sample posts are ready. Scroll past one, then reload to see it leave the feed.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not load the preview.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await startRefresh();
      setMessage("Refresh started. You can keep reading while it runs.");
      await reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Refresh could not start.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const isRefreshing = data?.refresh.status === "running" || data?.refresh.status === "starting";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" onClick={() => setView("today")}>Fieldnotes<span>.</span></a>
        <nav aria-label="Feed sections">
          {(["today", "people", "history"] as const).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>
          ))}
        </nav>
        <button className="refresh-button" disabled={busy || isRefreshing} onClick={() => void handleRefresh()}>
          <Icon name="refresh" /> <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </header>

      <main id="top">
        <section className="page-intro">
          <div>
            <span className="eyebrow">{today}</span>
            <h1>{view === "today" ? "Today’s reading" : view === "people" ? "Your people" : "Read history"}</h1>
          </div>
          <div className="edition-note">
            {view === "today" && <><strong>{data?.feed.length ?? 0}</strong><span>unread posts</span></>}
            {view === "people" && <><strong>{data?.profiles.length ?? 0}</strong><span>tracked people</span></>}
            {view === "history" && <><strong>{data?.history.length ?? 0}</strong><span>saved links</span></>}
          </div>
        </section>

        {(message || actionError) && (
          <div className={`notice ${actionError ? "error" : "success"}`} role={actionError ? "alert" : "status"}>
            <span>{actionError ?? message}</span>
            <button aria-label="Dismiss message" onClick={() => { setMessage(null); setActionError(null); }}>×</button>
          </div>
        )}

        {view === "today" && (
          <section className="feed" aria-label="Unread LinkedIn posts">
            {loading ? <Skeleton /> : data && data.feed.length > 0 ? (
              <>
                <div className="feed-rule"><span>Newest first</span><span>{sessionSeen.size > 0 ? `${sessionSeen.size} read this session` : "Scroll to mark read"}</span></div>
                {data.feed.map((post) => <FeedCard key={post.id} post={post} onSeen={handleSeen} />)}
                <div className="end-note"><span>End of today’s reading</span></div>
              </>
            ) : (
              <EmptyFeed hasProfiles={(data?.profiles.length ?? 0) > 0} demoMode={data?.demoMode ?? false} onUpload={() => fileInput.current?.click()} onDemo={() => void handleDemo()} />
            )}
          </section>
        )}

        {view === "people" && (
          <section className="people-view">
            <div className="section-action">
              <p>The next CSV replaces this active list without resetting read history.</p>
              <button className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="upload" /> Upload CSV</button>
            </div>
            {data?.profiles.length ? (
              <ol className="people-list">
                {data.profiles.map((profile, index) => (
                  <li key={profile.id}>
                    <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{profile.name ?? profile.linkedinUrl.split("/").at(-1)}</strong><a href={profile.linkedinUrl} target="_blank" rel="noreferrer">{profile.linkedinUrl.replace("https://www.", "")}</a></div>
                    <span className="last-seen">{profile.lastScrapedAt ? `Checked ${formatRelativeDate(profile.lastScrapedAt)}` : "Not checked yet"}</span>
                  </li>
                ))}
              </ol>
            ) : <EmptyFeed hasProfiles={false} demoMode={false} onUpload={() => fileInput.current?.click()} onDemo={() => undefined} />}
          </section>
        )}

        {view === "history" && (
          <section className="history-view">
            <p className="history-intro">Only the link, person, and date remain after you read a post.</p>
            {data?.history.length ? (
              <ol className="history-list">
                {data.history.map((item) => (
                  <li key={item.id}>
                    <div><strong>{item.profileName}</strong><span>Published {formatRelativeDate(item.publishedAt)} · Read {formatRelativeDate(item.seenAt)}</span></div>
                    <a href={item.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.profileName}'s post on LinkedIn`}><Icon name="arrow" /></a>
                  </li>
                ))}
              </ol>
            ) : <section className="empty-state compact"><span className="empty-kicker">No history yet</span><h2>Read links will collect here.</h2></section>}
          </section>
        )}
      </main>

      <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void handleFile(file); }} />
      <footer className="site-footer"><span>Private reading, one day at a time.</span><span>{data?.apifyConfigured ? "Apify connected" : "Apify not connected"}</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
