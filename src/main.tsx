import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { addFollows, getBootstrap, markSeen, removeFollow, startRefresh } from "./api";
import { parseLinkedInUrls } from "./linkedin";
import { isSupabaseConfigured, supabase } from "./supabase";
import type { Bootstrap, FeedPost } from "./types";
import "./styles.css";

type View = "today" | "people" | "history";
type SortMode = "recent" | "engaged";
const pendingUrlsKey = "focused-feed:pending-linkedin-urls";

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
  return <span className={`brand ${compact ? "compact" : ""}`}><img src="/focused-feed-mark.svg" alt="" /><span>Focused Feed</span></span>;
}

function GoogleMark() {
  return <svg className="google-mark" aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h5.4a4.7 4.7 0 0 1-2 3v2.8h3.5c2-1.9 3.2-4.6 3.2-7.9Z" /><path fill="#34a853" d="M12 22c2.9 0 5.3-1 7-2.6l-3.5-2.8c-1 .7-2.2 1-3.5 1-2.7 0-5-1.8-5.9-4.3H2.5v2.8A10 10 0 0 0 12 22Z" /><path fill="#fbbc05" d="M6.1 13.3A6 6 0 0 1 6 12c0-.5 0-.9.1-1.3V7.9H2.5A10 10 0 0 0 2 12c0 1.5.3 2.8.8 4.1l3.3-2.8Z" /><path fill="#ea4335" d="M12 6.4c1.6 0 3 .5 4.1 1.6l3.1-3A10 10 0 0 0 2.5 8l3.6 2.8A6 6 0 0 1 12 6.4Z" /></svg>;
}

function savePendingUrls(urls: string[]) {
  window.localStorage.setItem(pendingUrlsKey, JSON.stringify(urls));
}

function pendingUrls(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(pendingUrlsKey) ?? "[]");
    return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [];
  } catch {
    return [];
  }
}

function Skeleton() {
  return <div className="skeleton-list" aria-label="Loading your feed">{[0, 1, 2].map((item) => <div className="skeleton-card" key={item}><span className="skeleton-avatar" /><div><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line medium" /></div></div>)}</div>;
}

function PostAttachment({ post }: { post: FeedPost }) {
  const media = post.media;
  if (!media) return null;
  if (media.video) return <div className="post-media video-media"><video controls playsInline preload="metadata" poster={media.video.thumbnailUrl ?? undefined}><source src={media.video.url} type="video/mp4" />Your browser cannot play this video. <a href={post.linkedinUrl}>Open it on LinkedIn.</a></video></div>;
  if (media.images.length > 0) return <a className={`post-media image-grid image-count-${Math.min(media.images.length, 4)}`} href={post.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`View ${post.profileName}'s post on LinkedIn`}>{media.images.map((image, index) => <img key={image.url} src={image.url} alt={media.images.length > 1 ? `Post image ${index + 1} of ${media.images.length}` : "Post image"} loading="lazy" decoding="async" />)}</a>;
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
  return <article className="feed-card" ref={cardRef} data-seen={seen ? "true" : "false"}><div className="card-body"><header className="card-header"><div className="card-identity"><a className="avatar" href={post.profileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${post.profileName}'s LinkedIn profile`}>{post.profileAvatarUrl ? <img src={post.profileAvatarUrl} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">{initials(post.profileName)}</span>}</a><div className="identity-copy"><a className="person-name" href={post.profileUrl} target="_blank" rel="noreferrer">{post.profileName}</a>{post.profileHeadline && <span className="profile-headline">{post.profileHeadline}</span>}<span className="post-meta"><time dateTime={post.publishedAt}>{formatRelativeDate(post.publishedAt)}</time>{post.kind !== "original" && <><span aria-hidden="true">·</span><span className="post-kind">{post.kind}</span></>}</span></div></div>{seen && <span className="seen-mark"><Icon name="check" /> Read</span>}</header><p className={`post-copy ${isLong && !expanded ? "clamped" : ""}`}>{post.content}</p>{isLong && <button className="expand-post" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? "Show less" : "…see more"}</button>}<PostAttachment post={post} /><footer className="card-footer"><div className="metrics" aria-label={`${post.likes} reactions, ${post.comments} comments, and ${post.reposts} reposts`}><span><Icon name="heart" />{numberFormatter.format(post.likes)}</span><span><Icon name="comment" />{numberFormatter.format(post.comments)}</span>{post.reposts > 0 && <span><Icon name="repost" />{numberFormatter.format(post.reposts)}</span>}</div><a className="open-link" href={post.linkedinUrl} target="_blank" rel="noreferrer">Open on LinkedIn <Icon name="arrow" /></a></footer></div></article>;
}

function UrlEntry({ minimum = 1, initialValue = "", submitLabel = "Add people", onSubmit }: { minimum?: number; initialValue?: string; submitLabel?: string; onSubmit: (urls: string[]) => Promise<void> }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseLinkedInUrls(value);
    if (parsed.invalid.length > 0) return setError(`Check this entry: ${parsed.invalid[0]}`);
    if (parsed.urls.length < minimum) return setError(`Add at least ${minimum} LinkedIn profile URLs.`);
    setBusy(true);
    setError(null);
    try { await onSubmit(parsed.urls); setValue(""); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not add these people."); } finally { setBusy(false); }
  }
  return <form className="url-form" onSubmit={(event) => void submit(event)}><label htmlFor="linkedin-urls">LinkedIn profile URLs</label><textarea id="linkedin-urls" value={value} onChange={(event) => setValue(event.target.value)} placeholder="linkedin.com/in/person-one, linkedin.com/in/person-two, linkedin.com/in/person-three" rows={4} spellCheck={false} /><div className="url-form-footer"><span>Separate URLs with commas or new lines.</span><button className="primary-button" disabled={busy} type="submit"><Icon name="plus" />{busy ? "Adding…" : submitLabel}</button></div>{error && <p className="inline-error" role="alert">{error}</p>}</form>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [urls, setUrls] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function signupUrls(): string[] | null {
    setError(null);
    setMessage(null);
    const parsed = parseLinkedInUrls(urls);
    if (mode !== "signup") return [];
    if (parsed.invalid.length > 0) { setError(`Check this entry: ${parsed.invalid[0]}`); return null; }
    if (parsed.urls.length < 3) { setError("Start with at least three LinkedIn profile URLs."); return null; }
    savePendingUrls(parsed.urls);
    return parsed.urls;
  }
  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    const parsed = signupUrls();
    if (!parsed) return;
    setBusy(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: mode === "signup",
          ...(mode === "signup" ? { data: { linkedin_urls: parsed } } : {}),
        },
      });
      if (otpError) throw otpError;
      setMessage("Check your email for your secure sign-in link. You can close this tab after it arrives.");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not continue."); } finally { setBusy(false); }
  }
  async function continueWithGoogle() {
    const parsed = signupUrls();
    if (!parsed) return;
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
  return <main className="auth-page"><section className="auth-story"><Brand /><span className="auth-kicker">Signal over noise</span><h1>The people you care about.<br />Nothing else.</h1><p>A calm, private LinkedIn reader that remembers what you’ve seen and lets the rest disappear.</p><div className="focus-demo"><span /><span className="active" /><span /></div></section><section className="auth-card"><div className="auth-tabs" role="tablist"><button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} type="button">Create account</button><button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">Sign in</button></div><form onSubmit={(event) => void submitEmail(event)}>{mode === "signup" && <label>Who do you want to follow?<textarea value={urls} onChange={(event) => setUrls(event.target.value)} rows={5} required placeholder="Paste at least 3 LinkedIn URLs, separated by commas" spellCheck={false} /><small>Start with three. You can add more anytime.</small></label>}<button className="social-button" disabled={busy} type="button" onClick={() => void continueWithGoogle()}><GoogleMark />Continue with Google</button><div className="auth-divider"><span>or</span></div><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></label><button className="auth-submit" disabled={busy} type="submit">{busy ? "Sending…" : "Email me a sign-in link"}</button><p className="passwordless-note">No password. The link signs you in securely.</p>{error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}</form></section></main>;
}

function Onboarding({ session }: { session: Session }) {
  const metadataUrls = Array.isArray(session.user.user_metadata.linkedin_urls)
    ? session.user.user_metadata.linkedin_urls.filter((url): url is string => typeof url === "string")
    : [];
  const saved = (metadataUrls.length > 0 ? metadataUrls : pendingUrls()).join(", ");
  const [complete, setComplete] = useState(false);
  if (complete) return <div className="centered-state"><Brand /><h1>Building your feed…</h1><p>Your first week of posts is being collected. Reloading shortly.</p></div>;
  return <main className="onboarding-page"><Brand /><section className="onboarding-card"><span className="step-label">One quick step</span><h1>Choose your signal.</h1><p>Add at least three public LinkedIn profiles. We’ll collect their original posts and reposts—no LinkedIn login required.</p><UrlEntry minimum={3} initialValue={saved} submitLabel="Build my feed" onSubmit={async (urls) => { await addFollows(urls); await startRefresh(); window.localStorage.removeItem(pendingUrlsKey); setComplete(true); window.setTimeout(() => window.location.reload(), 4_000); }} /></section></main>;
}

function FeedApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<View>("today");
  const [sort, setSort] = useState<SortMode>("recent");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionSeen, setSessionSeen] = useState<Set<string>>(() => new Set());
  const reload = useCallback(async (signal?: AbortSignal) => { const next = await getBootstrap(signal); setData(next); setLoading(false); }, []);
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal).catch((error: unknown) => { if (error instanceof DOMException && error.name === "AbortError") return; setActionError(error instanceof Error ? error.message : "Could not load the feed."); setLoading(false); }); return () => controller.abort(); }, [reload]);
  useEffect(() => { if (data?.refresh.status !== "running" && data?.refresh.status !== "starting") return; const timeout = window.setTimeout(() => void reload().catch(() => undefined), 5_000); return () => window.clearTimeout(timeout); }, [data?.refresh.status, reload]);
  const sortedFeed = useMemo(() => {
    const posts = [...(data?.feed ?? [])];
    if (sort === "recent") return posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const score = (post: FeedPost) => post.likes + post.comments * 4 + post.reposts * 2;
    return posts.sort((a, b) => score(b) - score(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }, [data?.feed, sort]);
  const handleSeen = useCallback((id: string) => { setSessionSeen((current) => new Set(current).add(id)); void markSeen([id]).catch((error: unknown) => { setSessionSeen((current) => { const next = new Set(current); next.delete(id); return next; }); setActionError(error instanceof Error ? error.message : "Could not remember that post."); }); }, []);
  async function refresh() { setBusy(true); setActionError(null); try { await startRefresh(); setMessage("Refresh started. New posts will appear here shortly."); await reload(); } catch (error) { setActionError(error instanceof Error ? error.message : "Refresh could not start."); } finally { setBusy(false); } }
  const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const isRefreshing = data?.refresh.status === "running" || data?.refresh.status === "starting";
  return <div className="app-shell"><header className="topbar"><button className="brand-button" onClick={() => setView("today")}><Brand compact /></button><nav aria-label="Feed sections">{(["today", "people", "history"] as const).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}</nav><button className="refresh-button" disabled={busy || isRefreshing} onClick={() => void refresh()}><Icon name="refresh" /><span>{isRefreshing ? "Refreshing" : "Refresh"}</span></button></header><main id="top"><section className="page-intro"><div><span className="eyebrow">{today}</span><h1>{view === "today" ? "Today’s reading" : view === "people" ? "Your people" : "Read history"}</h1></div><div className="edition-note"><strong>{view === "today" ? sortedFeed.length : view === "people" ? data?.profiles.length ?? 0 : data?.history.length ?? 0}</strong><span>{view === "today" ? "unread posts" : view === "people" ? "tracked people" : "saved links"}</span></div></section>{(message || actionError) && <div className={`notice ${actionError ? "error" : "success"}`} role={actionError ? "alert" : "status"}><span>{actionError ?? message}</span><button aria-label="Dismiss message" onClick={() => { setMessage(null); setActionError(null); }}><Icon name="close" /></button></div>}{view === "today" && <section className="feed" aria-label="Unread LinkedIn posts">{loading ? <Skeleton /> : sortedFeed.length > 0 ? <><div className="feed-toolbar"><span>{sessionSeen.size > 0 ? `${sessionSeen.size} read this session` : "Scroll past to mark read"}</span><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">Most recent</option><option value="engaged">Most engaged</option></select></label></div>{sortedFeed.map((post) => <FeedCard key={post.id} post={post} onSeen={handleSeen} />)}<div className="end-note"><span>End of your focused feed</span></div></> : <section className="empty-state"><span className="empty-kicker">All caught up</span><h2>Nothing new to read.</h2><p>Refresh when you want to check for new posts.</p><button className="primary-button" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" />Refresh now</button></section>}</section>}{view === "people" && <section className="people-view"><UrlEntry onSubmit={async (urls) => { const result = await addFollows(urls); setMessage(`${result.added} ${result.added === 1 ? "person" : "people"} added.`); await reload(); }} />{data?.profiles.length ? <ol className="people-list">{data.profiles.map((profile, index) => <li key={profile.id}><span className="row-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{profile.name ?? profile.linkedinUrl.split("/").at(-1)}</strong><a href={profile.linkedinUrl} target="_blank" rel="noreferrer">{profile.linkedinUrl.replace("https://www.", "")}</a></div><span className="last-seen">{profile.lastScrapedAt ? `Checked ${formatRelativeDate(profile.lastScrapedAt)}` : "Not checked yet"}</span><button className="remove-person" aria-label={`Stop following ${profile.name ?? "this person"}`} onClick={() => void removeFollow(profile.id).then(() => reload())}><Icon name="close" /></button></li>)}</ol> : null}<button className="signout-button" onClick={() => void supabase.auth.signOut()}>Sign out</button></section>}{view === "history" && <section className="history-view"><p className="history-intro">Only the link, person, and date remain in your personal history.</p>{data?.history.length ? <ol className="history-list">{data.history.map((item) => <li key={item.id}><div><strong>{item.profileName}</strong><span>Published {formatRelativeDate(item.publishedAt)} · Read {formatRelativeDate(item.seenAt)}</span></div><a href={item.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.profileName}'s post on LinkedIn`}><Icon name="arrow" /></a></li>)}</ol> : <section className="empty-state compact"><span className="empty-kicker">No history yet</span><h2>Read links will collect here.</h2></section>}</section>}</main><footer className="site-footer"><span>Signal over noise.</span><span>Focused Feed</span></footer></div>;
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  useEffect(() => { void getBootstrap().then((data) => { const needsSetup = data.profiles.length < 3; if (!needsSetup) window.localStorage.removeItem(pendingUrlsKey); setNeedsOnboarding(needsSetup); }).catch(() => setNeedsOnboarding(true)); }, []);
  if (needsOnboarding === null) return <div className="centered-state"><Brand /><p>Loading your feed…</p></div>;
  return needsOnboarding ? <Onboarding session={session} /> : <FeedApp />;
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => data.subscription.unsubscribe(); }, []);
  if (!isSupabaseConfigured) return <div className="centered-state"><Brand /><h1>Connect Supabase to begin.</h1><p>Copy <code>.env.example</code> to <code>.env.local</code> and add your project values.</p></div>;
  if (session === undefined) return <div className="centered-state"><Brand /><p>Loading your feed…</p></div>;
  if (!session) return <AuthScreen />;
  return <AuthenticatedApp session={session} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
