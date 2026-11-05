"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Reduced-motion preference read after mount, so server and first client render match. */
function useReduceAfterMount() {
  const pref = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!pref;
}
import { cn } from "@hps/ui";
import { EASE, type StampId } from "@/components/game/primitives";

/** B7 scroll reveal: rise 32px and fade in once, via whileInView (IntersectionObserver), never a scroll listener. */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReduceAfterMount();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      // Reduced motion: content appears instantly, no rise.
      transition={reduce ? { duration: 0 } : { duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * B11 tagline reveal: words start at ~30% opacity and each one turns to full colour as it crosses a
 * trigger line, in reading order. One IntersectionObserver per word. Reduced motion shows the final text.
 */
export function TaglineReveal({ lines, className }: { lines: string[]; className?: string }) {
  const reduce = useReduceAfterMount();
  const words = lines.flatMap((line, li) => line.split(" ").map((w, wi) => ({ w, key: `${li}-${wi}`, lineEnd: wi === line.split(" ").length - 1 && li < lines.length - 1 })));
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const [lit, setLit] = useState<boolean[]>(() => words.map(() => false));

  useEffect(() => {
    if (reduce) return;
    const observers = refs.current.map((el, i) => {
      if (!el) return null;
      // Trigger line sits 40% up from the bottom of the viewport.
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            setLit((prev) => (prev[i] ? prev : prev.map((v, j) => (j === i ? true : v))));
            io.disconnect();
          }
        },
        { rootMargin: "0px 0px -40% 0px", threshold: 1 },
      );
      io.observe(el);
      return io;
    });
    return () => observers.forEach((o) => o?.disconnect());
  }, [reduce]);

  return (
    <p className={cn("headline-lg max-w-4xl text-ink", className)}>
      {words.map((x, i) => (
        <span key={x.key}>
          <span
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="transition-opacity duration-500 ease-base"
            style={{ opacity: reduce || lit[i] ? 1 : 0.3 }}
          >
            {x.w}
          </span>
          {x.lineEnd ? <br /> : " "}
        </span>
      ))}
    </p>
  );
}

/** A rubber stamp that slams down once it scrolls into view: oversized and faint, then pressed flat. */
export function StampReveal({ id, label, rotate, delay = 0 }: { id: StampId; label: string; rotate: number; delay?: number }) {
  const reduce = useReduceAfterMount();
  return (
    <motion.img
      src={`/art/stamps/${id}.webp`}
      alt={label}
      draggable={false}
      className="mx-auto w-full max-w-[280px] select-none"
      initial={{ opacity: 0, scale: 1.5, rotate }}
      whileInView={{ opacity: 1, scale: 1, rotate }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: [0.3, 1.4, 0.5, 1], delay }}
    />
  );
}
