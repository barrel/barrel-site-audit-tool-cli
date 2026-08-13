"use client";

import { useEffect, useState } from "react";
import { BARREL_FACTS } from "@/lib/barrel-facts";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A light "did you know?" distraction for the Run Audit wait — shuffled client-side (after
 * mount, to avoid an SSR/client hydration mismatch from Math.random()) so a long run doesn't
 * repeat the same fact back-to-back. */
export function BarrelFactTicker() {
  const [order, setOrder] = useState(BARREL_FACTS);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setOrder(shuffle(BARREL_FACTS));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % order.length), 7000);
    return () => clearInterval(id);
  }, [order.length]);

  return (
    <p key={index} className="text-sm text-[#6B6B6B]" style={{ animation: "fadein 0.5s ease-in" }}>
      <span className="font-semibold text-[#1A1A1A]">🛢️ Did you know? </span>
      {order[index % order.length]}
    </p>
  );
}
