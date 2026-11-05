"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SpeakerHighIcon as Volume2, SpeakerSlashIcon as VolumeX } from "@phosphor-icons/react/dist/ssr";
import { Button, cn } from "@hps/ui";
import { useAccount } from "@/hooks/use-account";
import { isMuted, setMuted } from "@/lib/sfx";
import { EASE } from "@/components/game/primitives";

export function MuteToggle() {
  const [muted, setM] = useState(false);
  useEffect(() => {
    setM(isMuted());
    const on = () => setM(isMuted());
    window.addEventListener("hps:mute", on);
    return () => window.removeEventListener("hps:mute", on);
  }, []);
  return (
    <Button variant="ghost" size="icon" aria-label={muted ? "Unmute sounds" : "Mute sounds"} aria-pressed={muted} onClick={() => setMuted(!muted)}>
      {muted ? <VolumeX /> : <Volume2 />}
    </Button>
  );
}

function useNavLinks() {
  const { account } = useAccount();
  return [
    { href: "/", label: "Play" },
    { href: "/store", label: "Store" },
    ...(account ? [{ href: "/library", label: "Library" }] : []),
    ...(account?.user.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
    { href: "/account", label: account ? account.user.displayName || "Account" : "Sign in", testid: "account-link" },
  ];
}

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <span className="relative block size-4" aria-hidden>
      <span className="absolute left-0 top-1 block h-0.5 w-4 bg-current transition-transform duration-500 ease-base" style={{ transform: open ? "translateY(4px) rotate(45deg)" : "none" }} />
      <span className="absolute bottom-1 left-0 block h-0.5 w-4 bg-current transition-transform duration-500 ease-base" style={{ transform: open ? "translateY(-4px) rotate(-45deg)" : "none" }} />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Hybrid Party Show home" className={cn("group flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan", className)}>
      <img src="/art/avatars/gavel.webp" alt="" width={36} height={36} className="size-9 transition-transform duration-500 ease-base group-hover:-rotate-12" />
      <span className="masthead whitespace-nowrap text-2xl sm:text-3xl">Hybrid Party Show</span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const links = useNavLinks();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header className="grain sticky top-0 z-40 bg-stage">
        <div className="mx-auto max-w-6xl px-4">
          {/* Dateline strip */}
          <div className="kicker hidden items-center justify-between border-b border-line py-1 text-ink-faint sm:flex">
            <span>Vol. 1 · Party edition</span>
            <span>3 to 12 players · No app needed</span>
            <span>All rise</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <Wordmark />
            <nav aria-label="Main" className="flex items-center gap-1">
              <ul className="hidden items-center gap-1 md:flex">
                {links.map((l) => {
                  const current = isCurrent(pathname, l.href);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={current ? "page" : undefined}
                        data-testid={l.testid}
                        className={cn(
                          "kicker block rounded-md px-3 py-2 transition-colors duration-300 ease-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                          current ? "highlighter text-ink" : "text-ink-soft hover:text-ink",
                        )}
                      >
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <MuteToggle />
              <Button variant="ghost" size="icon" className="md:hidden" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
                <MenuGlyph open={open} />
              </Button>
            </nav>
          </div>
          <div className="rule-double" aria-hidden />
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="fixed inset-0 z-30 flex flex-col bg-stage px-6 pt-32 md:hidden"
          >
            <ul className="flex flex-col gap-1">
              {links.map((l, i) => {
                const current = isCurrent(pathname, l.href);
                return (
                  <motion.li key={l.href} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: Math.min(i * 0.06, 0.4) }}>
                    <Link href={l.href} aria-current={current ? "page" : undefined} className={cn("headline-lg block border-b border-line py-3", current ? "text-chaos" : "text-ink")}>
                      {l.label}
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-24 w-full max-w-6xl px-4 pb-10">
      <div className="rule-double" aria-hidden />
      <div className="flex flex-wrap items-end justify-between gap-6 pt-6">
        <div>
          <p className="masthead text-2xl">Hybrid Party Show</p>
          <p className="caption-5 mt-2 max-w-sm text-ink-faint">Printed fresh every match. No microphone audio is ever recorded, and nothing for sale changes the score.</p>
        </div>
        <nav aria-label="Legal" className="kicker flex gap-6">
          <Link href="/store" className="text-ink-soft transition-colors duration-300 ease-base hover:text-ink">
            Store
          </Link>
          <Link href="/privacy" className="text-ink-soft transition-colors duration-300 ease-base hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="text-ink-soft transition-colors duration-300 ease-base hover:text-ink">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
