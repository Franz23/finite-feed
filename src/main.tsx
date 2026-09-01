import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { addFollows, getBootstrap, markSeen, removeFollow, startRefresh } from "./api";
import { parseSocialUrls } from "./social";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { Bootstrap, FeedPost, RefreshStatus } from "./types";
import "./styles.css";

type View = "today" | "people" | "history";
type SortMode = "recent" | "engaged";
const isGoogleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

const numberFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const claudeSelectionPrompt = `I want to create a focused LinkedIn reading list, not import my entire network.

Analyze the LinkedIn data export I attach. Start by asking what people, topics, industries, or relationships I want to stay current with.

Then recommend 10–25 people to follow. Prioritize:
1. How recently we exchanged messages.
2. Meaningful message volume and reciprocity.
3. Relevance to the goals I described.

Do not include company pages, weak one-off contacts, or people without a public LinkedIn profile URL. Do not reproduce private message content in the result.

Return:
- A short table with name, why they matter, and LinkedIn URL.
- A final comma-separated list containing only the selected LinkedIn profile URLs, ready to paste into Finite Feed.`;

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
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function Icon({ name }: { name: "heart" | "comment" | "repost" | "arrow" | "refresh" | "check" | "plus" | "close" }) {
  const paths = {
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
    comment: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
    repost: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
    arrow: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand ${compact ? "compact" : ""}`}><img src="/finite-feed-mark.svg" alt="" /><span>Finite Feed</span></span>;
}

function GoogleMark() {
  return <svg className="google-mark" aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h5.4a4.7 4.7 0 0 1-2 3v2.8h3.5c2-1.9 3.2-4.6 3.2-7.9Z" /><path fill="#34a853" d="M12 22c2.9 0 5.3-1 7-2.6l-3.5-2.8c-1 .7-2.2 1-3.5 1-2.7 0-5-1.8-5.9-4.3H2.5v2.8A10 10 0 0 0 12 22Z" /><path fill="#fbbc05" d="M6.1 13.3A6 6 0 0 1 6 12c0-.5 0-.9.1-1.3V7.9H2.5A10 10 0 0 0 2 12c0 1.5.3 2.8.8 4.1l3.3-2.8Z" /><path fill="#ea4335" d="M12 6.4c1.6 0 3 .5 4.1 1.6l3.1-3A10 10 0 0 0 2.5 8l3.6 2.8A6 6 0 0 1 12 6.4Z" /></svg>;
}

function FocusPreview() {
  return <div className="focus-preview" aria-hidden="true"><header><span>Today’s signal</span><strong>3</strong></header><div className="preview-stack"><div className="preview-post muted"><span className="preview-avatar">A</span><div><strong>Someone you follow</strong><span>Shared a new perspective</span></div><time>18m</time></div><div className="preview-post active"><span className="preview-avatar">B</span><div><strong>Worth your attention</strong><span>Original post · 42 reactions</span></div><time>2h</time></div><div className="preview-post muted"><span className="preview-avatar">C</span><div><strong>From your inner circle</strong><span>Reposted with context</span></div><time>5h</time></div></div><footer><span>End of today’s feed</span><Icon name="check" /></footer></div>;
}

function ClaudeSelectionGuide() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(claudeSelectionPrompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return <details className="selection-guide"><summary><span>Need help choosing people?</span><span>Use your LinkedIn network with Claude</span></summary><div className="selection-guide-body"><div className="selection-guide-copy"><span className="guide-kicker">Alternative method</span><h2>Turn your network into a shortlist.</h2><p>Your LinkedIn export is only a shortcut for giving Claude access to your network. You do not upload the archive to Finite Feed.</p><ol><li><span>1</span><p>In LinkedIn, open <strong>Settings → Data privacy → Download your data</strong> and request your archive.</p></li><li><span>2</span><p>Give that archive to Claude with the prompt below. Claude will help you choose the people worth following.</p></li><li><span>3</span><p>Copy Claude’s final list of profile URLs into Finite Feed above.</p></li></ol></div><figure><img src="/linkedin-data-download.png" alt="LinkedIn settings showing Data privacy selected and Download your data highlighted" loading="lazy" decoding="async" /><figcaption>Where to find LinkedIn’s data download.</figcaption></figure><div className="claude-prompt"><div className="claude-prompt-header"><strong>Prompt for Claude</strong><button type="button" onClick={() => void copyPrompt()}>{copyState === "copied" ? "Copied" : "Copy prompt"}</button></div><pre>{claudeSelectionPrompt}</pre>{copyState === "failed" && <p className="inline-error" role="alert">Copy failed. Select the prompt text and copy it manually.</p>}</div></div></details>;
}

function Skeleton() {
  return <div className="skeleton-list" aria-label="Loading your feed">{[0, 1, 2].map((item) => <div className="skeleton-card" key={item}><span className="skeleton-avatar" /><div><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line medium" /></div></div>)}</div>;
}

function RefreshProgress({ refresh, compact = false }: { refresh: RefreshStatus; compact?: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const elapsedSeconds = refresh.startedAt ? Math.max(0, Math.floor((now - Date.parse(refresh.startedAt)) / 1_000)) : 0;
  const stage = elapsedSeconds >= 90
    ? "Taking longer than expected"
    : refresh.status === "starting" || elapsedSeconds < 8
    ? "Starting the check"
    : elapsedSeconds < 30
      ? "Collecting recent posts"
      : "Processing the results";
  const profileLabel = `${refresh.profileCount || "Your"} ${refresh.profileCount === 1 ? "person" : "people"}`;
  return <section className={`refresh-progress ${compact ? "compact" : ""}`} role="status" aria-live="polite">
    <div className="refresh-progress-copy"><div><span className="refresh-label">Refresh in progress</span><strong>{stage}</strong></div><span className="refresh-timing">{profileLabel} · {elapsedSeconds}s</span></div>
    <div className="progress-track" role="progressbar" aria-label={`${stage} for ${profileLabel}`}><span /></div>
    {!compact && <p>You can keep reading or leave this page. New posts will appear automatically.</p>}
  </section>;
}

function PostAttachment({ post }: { post: FeedPost }) {
  const media = post.media;
  const platformName = post.platform === "x" ? "X" : "LinkedIn";
  if (!media) return null;
  if (media.video) return <div className="post-media video-media"><video controls playsInline preload="metadata" poster={media.video.thumbnailUrl ?? undefined}><source src={media.video.url} type="video/mp4" />Your browser cannot play this video. <a href={post.linkedinUrl}>Open it on {platformName}.</a></video></div>;
  if (media.images.length > 0) return <a className={`post-media image-grid image-count-${Math.min(media.images.length, 4)}`} href={post.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`View ${post.profileName}'s post on ${platformName}`}>{media.images.map((image, index) => <img key={image.url} src={image.url} alt={media.images.length > 1 ? `Post image ${index + 1} of ${media.images.length}` : "Post image"} loading="lazy" decoding="async" />)}</a>;
  if (media.document) return <a className="post-media document-media" href={media.document.url ?? post.linkedinUrl} target="_blank" rel="noreferrer">{media.document.coverUrl && <img src={media.document.coverUrl} alt="Document cover" loading="lazy" decoding="async" />}<span className="document-meta"><strong>{media.document.title?.trim() || "LinkedIn document"}</strong><span>{media.document.pageCount ? `${media.document.pageCount} pages` : "Open document"}</span></span></a>;
  return null;
}

function FeedCard({ post, onSeen }: { post: FeedPost; onSeen: (id: string) => void }) {
  const cardRef = useRef<HTMLElement>(null);
  const wasVisible = useRef(false);
  const marked = useRef(false);
  const [seen, setSeen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isLong = post.content.length > 680 || post.content.split("\n").length > 10;
  const platformName = post.platform === "x" ? "X" : "LinkedIn";
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry || marked.current) return;
      if (entry.isIntersecting) wasVisible.current = true;
      if (wasVisible.current && !entry.isIntersecting && entry.boundingClientRect.bottom < 88) {
        marked.current = true;
        setSeen(true);
        onSeen(post.id);
      }
    }, { threshold: [0, 0.5], rootMargin: "-76px 0px 0px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onSeen, post.id]);
  return <article className="feed-card" ref={cardRef} data-seen={seen ? "true" : "false"} data-kind={post.kind}>
    <div className="card-body">
      <header className="card-header"><div className="card-identity"><a className="avatar" href={post.profileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${post.profileName}'s ${platformName} profile`}>{post.profileAvatarUrl ? <img src={post.profileAvatarUrl} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">{initials(post.profileName)}</span>}</a><div className="identity-copy"><span className="identity-line"><a className="person-name" href={post.profileUrl} target="_blank" rel="noreferrer">{post.profileName}</a><span className={`platform-mark ${post.platform}`}>{platformName}</span></span>{post.profileHeadline && <span className="profile-headline">{post.profileHeadline}</span>}<span className="post-meta"><time dateTime={post.publishedAt}>{formatRelativeDate(post.publishedAt)}</time></span></div></div>{seen && <span className="seen-mark"><Icon name="check" /> Read</span>}</header>
      {post.kind !== "original" && <div className="repost-context"><Icon name="repost" /><span>{post.kind === "quote" ? "Shared with commentary by" : "Reposted by"} <strong>{post.profileName}</strong></span></div>}
      <p className={`post-copy ${isLong && !expanded ? "clamped" : ""}`}>{post.content}</p>
      {isLong && <button className="expand-post" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? "Show less" : "…see more"}</button>}
      <PostAttachment post={post} />
      <footer className="card-footer"><div className="metrics" aria-label={`${post.likes} reactions, ${post.comments} comments, and ${post.reposts} reposts`}><span><Icon name="heart" />{numberFormatter.format(post.likes)}</span><span><Icon name="comment" />{numberFormatter.format(post.comments)}</span>{post.reposts > 0 && <span><Icon name="repost" />{numberFormatter.format(post.reposts)}</span>}</div><a className="open-link" href={post.linkedinUrl} target="_blank" rel="noreferrer">Open on {platformName} <Icon name="arrow" /></a></footer>
    </div>
  </article>;
}

function UrlEntry({ minimum = 1, initialValue = "", submitLabel = "Add people", onSubmit }: { minimum?: number; initialValue?: string; submitLabel?: string; onSubmit: (urls: string[]) => Promise<void> }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseSocialUrls(value);
    if (parsed.invalid.length > 0) return setError(`Check this entry: ${parsed.invalid[0]}`);
    if (parsed.urls.length < minimum) return setError(`Add at least ${minimum} LinkedIn or X profile URLs.`);
    setBusy(true);
    setError(null);
    try { await onSubmit(parsed.urls); setValue(""); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not add these people."); } finally { setBusy(false); }
  }
  return <form className="url-form" onSubmit={(event) => void submit(event)}><label htmlFor="social-urls">LinkedIn or X profile URLs</label><textarea id="social-urls" value={value} onChange={(event) => setValue(event.target.value)} placeholder="linkedin.com/in/person, x.com/handle" rows={4} spellCheck={false} /><div className="url-form-footer"><span>Separate URLs with commas or new lines.</span><button className="primary-button" disabled={busy} type="submit"><Icon name="plus" />{busy ? "Adding…" : submitLabel}</button></div>{error && <p className="inline-error" role="alert">{error}</p>}</form>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: mode === "signup",
        },
      });
      if (otpError) throw otpError;
      setMessage("Check your email for your secure sign-in link. You can close this tab after it arrives.");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not continue."); } finally { setBusy(false); }
  }
  async function continueWithGoogle() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) throw oauthError;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not continue with Google.");
      setBusy(false);
    }
  }
  return <main className="auth-page"><section className="auth-story"><Brand /><div className="auth-thesis"><span className="auth-kicker">Your social feed, edited</span><h1>Keep up with<br />the few who matter.</h1><p>A private daily reading list from the people you choose. Read it once, reach the end, get on with your day.</p></div><FocusPreview /></section><section className="auth-panel"><div className="auth-card"><div className="auth-heading"><span>{mode === "signup" ? "Start your finite feed" : "Welcome back"}</span><p>{mode === "signup" ? "Create your account first. You’ll choose people next." : "We’ll email you a secure sign-in link."}</p></div><div className="auth-tabs" role="tablist"><button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} type="button">Create account</button><button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">Sign in</button></div><form onSubmit={(event) => void submitEmail(event)}>{isGoogleAuthEnabled && <><button className="social-button" disabled={busy} type="button" onClick={() => void continueWithGoogle()}><GoogleMark />Continue with Google</button><div className="auth-divider"><span>or</span></div></>}<label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></label><button className="auth-submit" disabled={busy} type="submit">{busy ? "Sending…" : "Continue with email"}</button><p className="passwordless-note">No password to remember.</p>{error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}</form></div></section></main>;
}

function Onboarding() {
  const [complete, setComplete] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [pollCycle, setPollCycle] = useState(0);
  useEffect(() => {
    if (!complete) return;
    let stopped = false;
    let timeout: number | undefined;
    async function checkRefresh() {
      try {
        const data = await getBootstrap();
        if (stopped) return;
        if (data.feed.length > 0 || data.refresh.status === "succeeded") {
          window.location.reload();
          return;
        }
        if (data.refresh.status === "failed") {
          setBuildError(data.refresh.error ?? "The first refresh did not finish.");
          return;
        }
      } catch {
        if (stopped) return;
      }
      timeout = window.setTimeout(() => void checkRefresh(), 3_000);
    }
    void checkRefresh();
    return () => { stopped = true; if (timeout) window.clearTimeout(timeout); };
  }, [complete, pollCycle]);
  if (complete) return <div className="centered-state building-state"><Brand /><span className="building-pulse" aria-hidden="true" /><h1>{buildError ? "The refresh paused." : "Building your feed…"}</h1><p>{buildError ?? "Checking the past week for posts. This usually takes less than a minute."}</p>{buildError && <button className="primary-button" type="button" onClick={() => { setBuildError(null); void startRefresh().then(() => setPollCycle((current) => current + 1)).catch((error: unknown) => setBuildError(error instanceof Error ? error.message : "Could not retry the refresh.")); }}><Icon name="refresh" />Retry refresh</button>}</div>;
  return <main className="onboarding-page"><header className="onboarding-header"><Brand /><ol className="setup-progress" aria-label="Account setup progress"><li className="done"><Icon name="check" /><span>Account</span></li><li className="active"><span>2</span><span>Choose people</span></li><li><span>3</span><span>Read</span></li></ol></header><section className="onboarding-layout"><div className="onboarding-intro"><span className="step-label">Build your reading list</span><h1>Whose updates are worth your time?</h1><p>Paste at least three public LinkedIn or X profiles. Finite Feed collects their original posts and reposts without needing either account login.</p><div className="privacy-note"><Icon name="check" /><span>You can add or remove people whenever you like.</span></div></div><div className="onboarding-card"><div className="onboarding-card-heading"><strong>Your first people</strong><span>Minimum 3</span></div><UrlEntry minimum={3} submitLabel="Build my feed" onSubmit={async (urls) => { await addFollows(urls); await startRefresh(); setComplete(true); }} /></div></section><ClaudeSelectionGuide /></main>;
}

function FeedApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("today");
  const [sort, setSort] = useState<SortMode>("recent");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [sessionSeen, setSessionSeen] = useState<Set<string>>(() => new Set());
  const autoRefreshAttempted = useRef(false);
  const reload = useCallback(async (signal?: AbortSignal) => { const next = await getBootstrap(signal); setData(next); setLoading(false); }, []);
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal).catch((error: unknown) => { if (error instanceof DOMException && error.name === "AbortError") return; setActionError(error instanceof Error ? error.message : "Could not load the feed."); setLoading(false); }); return () => controller.abort(); }, [reload]);
  useEffect(() => {
    if (data?.refresh.status !== "running" && data?.refresh.status !== "starting") return;
    const interval = window.setInterval(() => void reload().catch(() => undefined), 5_000);
    return () => window.clearInterval(interval);
  }, [data?.refresh.status, reload]);
  useEffect(() => {
    if (!data || autoRefreshAttempted.current || data.profiles.length < 3) return;
    autoRefreshAttempted.current = true;
    void startRefresh().then((status) => {
      if (status === "running" || status === "starting") return reload();
    }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : "Could not check for new posts."));
  }, [data, reload]);
  const sortedFeed = useMemo(() => {
    const posts = [...(data?.feed ?? [])];
    if (sort === "recent") return posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const score = (post: FeedPost) => post.likes + post.comments * 4 + post.reposts * 2;
    return posts.sort((a, b) => score(b) - score(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }, [data?.feed, sort]);
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return data?.history ?? [];
    return (data?.history ?? []).filter((item) =>
      item.profileName.toLowerCase().includes(query) || item.linkedinUrl.toLowerCase().includes(query),
    );
  }, [data?.history, historyQuery]);
  const handleSeen = useCallback((id: string) => { setSessionSeen((current) => new Set(current).add(id)); void markSeen([id]).catch((error: unknown) => { setSessionSeen((current) => { const next = new Set(current); next.delete(id); return next; }); setActionError(error instanceof Error ? error.message : "Could not remember that post."); }); }, []);
  async function refresh() { setBusy(true); setActionError(null); try { await startRefresh(true); setMessage("Refresh started. New posts will appear here shortly."); await reload(); } catch (error) { setActionError(error instanceof Error ? error.message : "Refresh could not start."); } finally { setBusy(false); } }
  const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const isRefreshing = data?.refresh.status === "running" || data?.refresh.status === "starting";
  const refreshFailed = data?.refresh.status === "failed";
  return <div className="app-shell">
    <header className="topbar">
      <button className="brand-button" onClick={() => setView("today")}><Brand compact /></button>
      <nav aria-label="Feed sections">{(["today", "people", "history"] as const).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}</nav>
      <button className="refresh-button" disabled={busy || isRefreshing} onClick={() => void refresh()}><Icon name="refresh" /><span>{isRefreshing ? "Refreshing" : "Refresh"}</span></button>
    </header>
    <main id="top">
      <section className="page-intro"><div><span className="eyebrow">{today}</span><h1>{view === "today" ? "Today’s reading" : view === "people" ? "Your people" : "Read history"}</h1></div><div className="edition-note"><strong>{view === "today" ? sortedFeed.length : view === "people" ? data?.profiles.length ?? 0 : filteredHistory.length}</strong><span>{view === "today" ? "unread posts" : view === "people" ? "tracked people" : historyQuery ? "matching links" : "saved links"}</span></div></section>
      {(message || actionError) && <div className={`notice ${actionError ? "error" : "success"}`} role={actionError ? "alert" : "status"}><span>{actionError ?? message}</span><button aria-label="Dismiss message" onClick={() => { setMessage(null); setActionError(null); }}><Icon name="close" /></button></div>}
      {refreshFailed && (view !== "today" || sortedFeed.length > 0) && <div className="refresh-failure" role="alert"><div><strong>Refresh failed.</strong><span>{data?.refresh.error ?? "The latest check did not finish."}</span></div><button className="primary-button" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />Retry</button></div>}
      {view === "today" && <section className="feed" aria-label="Unread LinkedIn posts">{isRefreshing && data && <RefreshProgress refresh={data.refresh} compact={sortedFeed.length > 0} />}{loading ? <Skeleton /> : sortedFeed.length > 0 ? <><div className="feed-toolbar"><span>{sessionSeen.size > 0 ? `${sessionSeen.size} read this session` : "Scroll past to mark read"}</span><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">Most recent</option><option value="engaged">Most engaged</option></select></label></div>{sortedFeed.map((post) => <FeedCard key={post.id} post={post} onSeen={handleSeen} />)}<div className="end-note"><span>End of your finite feed</span></div></> : isRefreshing ? null : refreshFailed ? <section className="empty-state"><span className="empty-kicker">Refresh stopped</span><h2>Let’s try that again.</h2><p>{data?.refresh.error ?? "The last refresh did not finish."}</p><button className="primary-button" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />Retry refresh</button></section> : <section className="empty-state"><span className="empty-kicker">All caught up</span><h2>Nothing new to read.</h2><p>Refresh when you want to check for new posts.</p><button className="primary-button" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />Refresh now</button></section>}</section>}
      {view === "people" && <section className="people-view"><UrlEntry onSubmit={async (urls) => { const result = await addFollows(urls); const status = await startRefresh(); setMessage(`${result.added} ${result.added === 1 ? "person" : "people"} added${status === "fresh" ? "." : " — checking for posts now."}`); await reload(); }} />{isRefreshing && data && <RefreshProgress refresh={data.refresh} compact />}{data?.profiles.length ? <ol className="people-list">{data.profiles.map((profile, index) => <li key={profile.id}><span className="row-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{profile.name ?? profile.linkedinUrl.split("/").at(-1)}</strong><a href={profile.linkedinUrl} target="_blank" rel="noreferrer">{profile.linkedinUrl.replace("https://www.", "")}</a></div><span className="last-seen">{profile.lastScrapedAt ? `Checked ${formatRelativeDate(profile.lastScrapedAt)}` : isRefreshing ? "Checking now" : "Not checked yet"}</span><button className="remove-person" aria-label={`Stop following ${profile.name ?? "this person"}`} onClick={() => void removeFollow(profile.id).then(() => reload())}><Icon name="close" /></button></li>)}</ol> : null}<button className="signout-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></section>}
      {view === "history" && <section className="history-view"><div className="history-search"><label htmlFor="history-query">Search read history</label><input id="history-query" type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search by person or LinkedIn URL" /></div><p className="history-intro">Only the link, person, and date remain in your personal history.</p>{filteredHistory.length > 0 ? <ol className="history-list">{filteredHistory.map((item) => <li key={item.id}><div><strong>{item.profileName}</strong><span>Published {formatRelativeDate(item.publishedAt)} · Read {formatRelativeDate(item.seenAt)}</span></div><a href={item.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.profileName}'s post on LinkedIn`}><Icon name="arrow" /></a></li>)}</ol> : historyQuery ? <section className="empty-state compact"><span className="empty-kicker">No matches</span><h2>Try another person or URL.</h2><button className="text-button" type="button" onClick={() => setHistoryQuery("")}>Clear search</button></section> : <section className="empty-state compact"><span className="empty-kicker">No history yet</span><h2>Read links will collect here.</h2></section>}</section>}
    </main>
    <footer className="site-footer"><span>Signal over noise.</span><span>Finite Feed</span></footer>
  </div>;
}

function AuthenticatedApp() {
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  useEffect(() => { void getBootstrap().then((data) => setNeedsOnboarding(data.profiles.length < 3)).catch(() => setNeedsOnboarding(true)); }, []);
  if (needsOnboarding === null) return <div className="centered-state"><Brand /><p>Loading your feed…</p></div>;
  return needsOnboarding ? <Onboarding /> : <FeedApp />;
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => data.subscription.unsubscribe(); }, []);
  if (!isSupabaseConfigured) return <div className="centered-state"><Brand /><h1>Connect Supabase to begin.</h1><p>Copy <code>.env.example</code> to <code>.env.local</code> and add your project values.</p></div>;
  if (session === undefined) return <div className="centered-state"><Brand /><p>Loading your feed…</p></div>;
  if (!session) return <AuthScreen />;
  return <AuthenticatedApp />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
