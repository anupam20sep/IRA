import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useCockpit } from "@/store/cockpit";

export function NeuralPulse() {
  const processing = useCockpit((s) => s.processing);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const size = 220;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      phase.current += processing ? 0.08 : 0.025;
      const energy = processing ? 1.35 : 0.85;

      for (let ring = 0; ring < 4; ring++) {
        const r = 38 + ring * 22 + Math.sin(phase.current + ring) * 4 * energy;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle =
          ring % 2 === 0
            ? `rgba(34, 211, 238, ${0.35 - ring * 0.06})`
            : `rgba(168, 85, 247, ${0.28 - ring * 0.05})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      const g = ctx.createRadialGradient(cx, cy, 8, cx, cy, 54);
      g.addColorStop(0, processing ? "rgba(34,211,238,0.95)" : "rgba(34,211,238,0.7)");
      g.addColorStop(0.45, "rgba(168,85,247,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, 52 + Math.sin(phase.current * 1.4) * 3 * energy, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      for (let i = 0; i < 18; i++) {
        const a = phase.current * (processing ? 1.6 : 0.7) + (i / 18) * Math.PI * 2;
        const rr = 70 + Math.sin(phase.current * 2 + i) * 10 * energy;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.arc(x, y, processing ? 2.2 : 1.4, 0, Math.PI * 2);
        ctx.fillStyle = i % 3 === 0 ? "#a855f7" : "#22d3ee";
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [processing]);

  return (
    <div className="relative flex flex-col items-center">
      <motion.div
        animate={{
          scale: processing ? [1, 1.03, 1] : 1,
          filter: processing
            ? ["drop-shadow(0 0 18px rgba(34,211,238,0.45))", "drop-shadow(0 0 28px rgba(168,85,247,0.4))", "drop-shadow(0 0 18px rgba(34,211,238,0.45))"]
            : "drop-shadow(0 0 16px rgba(34,211,238,0.25))",
        }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <canvas ref={canvasRef} aria-hidden />
      </motion.div>
      <div className="-mt-2 text-center">
        <p className="text-glow text-3xl font-semibold tracking-[0.35em] text-ira-cyan">
          IRA
        </p>
        <p className="mt-1 text-xs tracking-[0.18em] text-slate-400 uppercase">
          Intelligent Resource Automation
        </p>
        <p className="mt-2 font-mono text-[10px] text-ira-cyan/70">
          {processing ? "PROCESSING · NEURAL PULSE ACTIVE" : "STANDBY · GOD MODE ONLINE"}
        </p>
      </div>
    </div>
  );
}
