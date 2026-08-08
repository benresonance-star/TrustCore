import { useState } from "react";

export function CopyIdChip({
  id,
  label = "ID",
}: {
  id: string | undefined | null;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id!);
      } else {
        throw new Error("clipboard unavailable");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const short =
    id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;

  return (
    <button
      type="button"
      className="copy-id-chip"
      title={id}
      aria-label={`Copy ${label} ${id}`}
      onClick={() => void copy()}
    >
      <span className="copy-id-chip-label">{label}</span>
      <code>{short}</code>
      <span className="copy-id-chip-action">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
