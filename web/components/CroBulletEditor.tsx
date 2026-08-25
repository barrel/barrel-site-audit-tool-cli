"use client";

import { useEffect, useRef, useState } from "react";
import type { CroBullet, CroBulletEdit } from "@/lib/shared";

/** Corrects one bullet.
 *
 * Saves to an overlay, never into the generated report — see /api/cro-edits for why. The original
 * wording stays visible above the fields for the whole edit, because the common case is a strategist
 * changing three words and needing to see what the other words were.
 *
 * Server-side validation is the authority on shape; the counters here are so the limit is visible
 * before the save rather than after it. */
export function CroBulletEditor({
  bullet,
  slug,
  croId,
  edit,
  onClose,
  onSaved,
}: {
  bullet: CroBullet;
  slug: string;
  croId: string;
  edit?: CroBulletEdit;
  onClose: () => void;
  onSaved: (bullets: Record<string, CroBulletEdit>) => void;
}) {
  const [title, setTitle] = useState(edit?.title ?? bullet.title);
  const [description, setDescription] = useState(edit?.description ?? bullet.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/cro-edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, id: croId, bulletId: bullet.id, ...payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "The edit could not be saved.");
        return;
      }
      onSaved(data.edits.bullets);
    } catch (err) {
      setError(`The edit could not be saved: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setSaving(false);
    }
  }

  const edited = title !== bullet.title || description !== bullet.description;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Edit bullet"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
        <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Edit this bullet</h2>
            <p className="text-[11px] text-[#9A9A9A] mt-0.5">
              Saved separately from the generated audit, which is left exactly as it was written.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[#9A9A9A] hover:text-[#1A1A1A] text-lg leading-none">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-[#fafafa] border border-[#E5E5E5] rounded-md px-3 py-2">
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-1">As generated</div>
            <p className="text-[12.5px] text-[#6B6B6B] leading-relaxed">
              <b className="font-semibold text-[#1A1A1A]">{bullet.title}:</b> {bullet.description}
            </p>
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Title</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full border border-[#E5E5E5] rounded-md px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#9A9A9A]"
            />
            <span className="text-[10px] text-[#9A9A9A]">
              {title.trim().split(/\s+/).filter(Boolean).length} words — at most 7, and no colon
            </span>
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="mt-1 w-full border border-[#E5E5E5] rounded-md px-3 py-2 text-sm text-[#1A1A1A] leading-relaxed focus:outline-none focus:border-[#9A9A9A]"
            />
            <span className="text-[10px] text-[#9A9A9A]">{description.trim().length} characters</span>
          </label>

          {error && <p className="text-[12.5px] text-[#B91C1C] leading-relaxed">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[#E5E5E5] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => submit({ hidden: true })}
              className="text-[13px] text-[#B91C1C] hover:underline disabled:opacity-50"
            >
              Hide from the deck
            </button>
            {edit && (
              <button
                type="button"
                disabled={saving}
                onClick={() => submit({ reset: true })}
                className="text-[13px] text-[#6B6B6B] hover:underline disabled:opacity-50"
              >
                Revert to generated
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={saving || !edited}
            onClick={() => submit({ title, description })}
            className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg disabled:opacity-40 disabled:hover:bg-[#1A1A1A] transition-colors"
          >
            {saving ? "Saving…" : "Save edit"}
          </button>
        </div>
      </div>
    </div>
  );
}
