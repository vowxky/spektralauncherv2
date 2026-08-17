import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useIntro } from "../stores/introStore";

const SIZE = 160;
const FALLBACK = { x: 28, y: 22 };
const IDLE_MS = 1100;
const FLY_MS = 950;
const REVEAL_MS = 700;

type Phase = "idle" | "fly" | "settled";

export default function SpektraIntro() {
  const setActive = useIntro((s) => s.setActive);
  const setLogoPos = useIntro((s) => s.setLogoPos);
  const logoPos = useIntro((s) => s.logoPos);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    setActive(true);
    return () => setActive(false);
  }, [setActive]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLImageElement>("[data-logo]");
      if (el) {
        const rect = el.getBoundingClientRect();
        setLogoPos({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
      setPhase("fly");
    }, IDLE_MS);
    return () => clearTimeout(timer);
  }, [setLogoPos]);

  useEffect(() => {
    if (phase !== "fly") return;
    const timer = setTimeout(() => setPhase("settled"), FLY_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const target = logoPos ?? FALLBACK;
  const flying = phase === "fly" || phase === "settled";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        pointerEvents: phase === "settled" ? "none" : "all",
      }}
    >
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: phase === "settled" ? 0 : 1 }}
        transition={{ duration: REVEAL_MS / 1000, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(1200px 720px at center, #14141a 0%, #0a0a0c 55%, #050507 100%)",
        }}
      />

      <motion.img
        src="./icon.png"
        alt=""
        initial={{ scale: 0.85, opacity: 0, rotate: -4 }}
        animate={
          flying
            ? { scale: 24 / SIZE, x: target.x - cx, y: target.y - cy, rotate: 540, opacity: 1 }
            : { scale: 1, opacity: 1, rotate: 0 }
        }
        transition={
          flying
            ? { duration: FLY_MS / 1000, ease: [0.5, 0, 0.15, 1] }
            : { duration: 0.9, ease: "easeOut" }
        }
        style={{
          position: "relative",
          width: SIZE,
          height: SIZE,
          filter: "grayscale(1) brightness(1.25)",
        }}
      />
    </div>
  );
}
