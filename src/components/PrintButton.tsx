"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn dark" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
