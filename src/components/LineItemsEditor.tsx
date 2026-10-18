"use client";

import { useState } from "react";
import { dollarsToCents, formatMoney, lineTotalCents } from "@/lib/money";

type Line = { key: number; description: string; quantity: string; unitPrice: string };

export function LineItemsEditor({ currency }: { currency: string }) {
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: "", quantity: "1", unitPrice: "" }]);
  const [nextKey, setNextKey] = useState(2);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => {
    setLines((ls) => [...ls, { key: nextKey, description: "", quantity: "1", unitPrice: "" }]);
    setNextKey((k) => k + 1);
  };
  const remove = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const total = lines.reduce((sum, l) => {
    const cents = dollarsToCents(l.unitPrice);
    const qty = Number(l.quantity);
    return cents !== null && qty > 0 ? sum + lineTotalCents(qty, cents) : sum;
  }, 0);

  return (
    <div className="items">
      <div className="line muted small" aria-hidden>
        <span>Description</span><span>Qty</span><span>Unit price</span><span />
      </div>
      {lines.map((l, i) => (
        <div className="line" key={l.key}>
          <input name="description" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="e.g. Website design" maxLength={200} aria-label={`Line ${i + 1} description`} />
          <input name="quantity" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} />
          <input name="unitPrice" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={`Line ${i + 1} unit price`} />
          <button type="button" className="btn ghost small" onClick={() => remove(l.key)} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`}>×</button>
        </div>
      ))}
      <div className="row between" style={{ marginTop: 8 }}>
        <button type="button" className="btn ghost small" onClick={add} disabled={lines.length >= 50}>+ Add line</button>
        <div><span className="muted">Total </span><strong>{formatMoney(total, currency)}</strong></div>
      </div>
    </div>
  );
}
