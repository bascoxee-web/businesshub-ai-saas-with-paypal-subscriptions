"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type Card = { id: string; kind: string; summary: string; state: "pending" | "working" | "confirmed" | "dismissed" | "error"; href?: string; error?: string };

const SUGGESTIONS = [
  "Who are my active clients?",
  "Which invoices are still unpaid?",
  "Add a client called Maple Studio, email hello@maple.example",
  "Draft a friendly payment reminder for my oldest unpaid invoice",
];

export function AssistantChat({ initialCards }: { initialCards: { id: string; kind: string; summary: string }[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [cards, setCards] = useState<Card[]>(initialCards.map((c) => ({ ...c, state: "pending" as const })));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-20) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setMessages([...next, { role: "assistant", content: data.reply }]);
        const fresh: Card[] = (data.proposals ?? []).map((p: { id: string; kind: string; summary: string }) => ({ ...p, state: "pending" as const }));
        if (fresh.length) setCards((c) => [...fresh, ...c]);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      router.refresh();
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }), 50);
    }
  }

  async function decide(id: string, action: "confirm" | "dismiss") {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, state: "working" } : c)));
    try {
      const res = await fetch(`/api/assistant/proposals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      setCards((cs) =>
        cs.map((c) => {
          if (c.id !== id) return c;
          if (!res.ok) return { ...c, state: "error", error: data.error ?? "Something went wrong." };
          return action === "confirm" ? { ...c, state: "confirmed", href: data.href } : { ...c, state: "dismissed" };
        }),
      );
    } catch {
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, state: "error", error: "Couldn't reach the server." } : c)));
    }
  }

  const visibleCards = cards.filter((c) => c.state !== "dismissed");

  return (
    <div className="u-max-width-760px">
      {messages.length === 0 && (
        <div className="card">
          <p className="muted u-margin-top-0" >Ask about your clients, projects and invoices, or tell me what to add. I'll show you a card to confirm before anything is saved.</p>
          <div className="row">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn ghost small" type="button" onClick={() => send(s)} disabled={busy}>{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "user" : "bot"}`}>{m.content}</div>
        ))}
        {busy && <div className="msg bot muted">Thinking…</div>}
      </div>

      {error && <div className="banner" role="alert">{error}</div>}

      {visibleCards.length > 0 && (
        <div className="card">
          <h2>Waiting for your OK</h2>
          {visibleCards.map((c) => (
            <div className="proposal u-margin-bottom-10px" key={c.id} >
              <div>{c.summary}</div>
              {c.state === "pending" && (
                <div className="row u-margin-top-8px" >
                  <button className="btn small" type="button" onClick={() => decide(c.id, "confirm")}>Confirm</button>
                  <button className="btn ghost small" type="button" onClick={() => decide(c.id, "dismiss")}>Dismiss</button>
                </div>
              )}
              {c.state === "working" && <div className="muted small u-margin-top-8px" >Working…</div>}
              {c.state === "confirmed" && (
                <div className="small u-margin-top-8px-color-var-ok" >
                  Done. {c.href ? <Link href={c.href}>Open it</Link> : null}
                </div>
              )}
              {c.state === "error" && <div className="small u-margin-top-8px-color-var-bad" >{c.error}</div>}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="row u-align-items-flex-end" >
        <div className="u-flex-1-min-width-240px">
          <label htmlFor="msg" className="muted small">Message</label>
          <textarea id="msg" value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} className="u-min-height-56px"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }} />
        </div>
        <button className="btn" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
      <p className="muted small">The conversation isn't saved: refreshing starts a fresh chat. Suggestions waiting for your OK are kept.</p>
    </div>
  );
}
