import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Shuffle, ChevronLeft, LoaderCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type StyleId = "mesh" | "aurora" | "lowpoly" | "orbs" | "lines" | "noise";
type PaletteId = "midnight" | "cosmic" | "ember" | "ocean" | "forest" | "rose" | "sand" | "mono";

interface StyleDef { id: StyleId; name: string }
interface PaletteDef { id: PaletteId; name: string; colors: [string, string, string, string] }

interface CoverGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (file: File) => Promise<void> | void;
  projectName: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const STYLES: StyleDef[] = [
  { id: "mesh",    name: "Mesh" },
  { id: "aurora",  name: "Aurora" },
  { id: "lowpoly", name: "Low Poly" },
  { id: "orbs",    name: "Orbs" },
  { id: "lines",   name: "Lines" },
  { id: "noise",   name: "Noise" },
];

const PALETTES: PaletteDef[] = [
  { id: "midnight", name: "Midnight", colors: ["#07071a", "#12124a", "#2d1b69", "#6d28d9"] },
  { id: "cosmic",   name: "Cosmic",   colors: ["#050015", "#2d0078", "#7c00ff", "#e040fb"] },
  { id: "ember",    name: "Ember",    colors: ["#1a0500", "#7c2d12", "#dc2626", "#f97316"] },
  { id: "ocean",    name: "Ocean",    colors: ["#020c1b", "#0c2a4a", "#0369a1", "#22d3ee"] },
  { id: "forest",   name: "Forest",   colors: ["#041a0a", "#064e3b", "#059669", "#6ee7b7"] },
  { id: "rose",     name: "Rose",     colors: ["#1a0010", "#831843", "#db2777", "#f9a8d4"] },
  { id: "sand",     name: "Sand",     colors: ["#1c1209", "#78350f", "#d97706", "#fde68a"] },
  { id: "mono",     name: "Mono",     colors: ["#050505", "#1a1a1a", "#404040", "#a3a3a3"] },
];

const CANVAS_SIZE = 800;
const THUMB_SIZE  = 64;
const THUMB_SEED  = 42;

// ─── RNG ─────────────────────────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = seed >>> 0;
  return (): number => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

function addGrain(ctx: CanvasRenderingContext2D, size: number, rand: () => number, strength: number) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const s = strength * 255;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * s;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// Draws the canvas content back onto itself with a blur, creating a soft bloom/glow.
function applyBloom(ctx: CanvasRenderingContext2D, size: number, blurPx: number, alpha: number) {
  const tmp = document.createElement("canvas");
  tmp.width = size; tmp.height = size;
  const t = tmp.getContext("2d")!;
  t.filter = `blur(${blurPx}px)`;
  t.drawImage(ctx.canvas, 0, 0);
  t.filter = "none";
  ctx.globalAlpha = alpha;
  ctx.drawImage(tmp, 0, 0);
  ctx.globalAlpha = 1;
}

// ─── Generators ───────────────────────────────────────────────────────────────

function drawMesh(ctx: CanvasRenderingContext2D, size: number, colors: string[], seed: number) {
  const rand = makeRng(seed);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, colors[0]);
  bg.addColorStop(1, colors[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 9; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.22 + rand() * 0.55);
    const color = colors[Math.floor(rand() * colors.length)];
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, hexToRgba(color, 0.5 + rand() * 0.35));
    grad.addColorStop(0.4, hexToRgba(color, 0.2 + rand() * 0.2));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  applyBloom(ctx, size, size * 0.018, 0.65);
  applyBloom(ctx, size, size * 0.06,  0.55);
  applyBloom(ctx, size, size * 0.14,  0.35);
  addGrain(ctx, size, rand, 0.11);
}

function drawAurora(ctx: CanvasRenderingContext2D, size: number, colors: string[], seed: number) {
  const rand = makeRng(seed);
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, size, size);

  const bandCount = 3 + Math.floor(rand() * 2);
  for (let b = 0; b < bandCount; b++) {
    const color = colors[1 + (b % (colors.length - 1))];
    const yCenter = size * (0.12 + b * (0.65 / bandCount) + rand() * 0.07);
    const thickness = size * (0.13 + rand() * 0.14);
    const amp = size * (0.04 + rand() * 0.07);
    const freq = 0.0018 + rand() * 0.003;
    const phase = rand() * Math.PI * 2;

    ctx.beginPath();
    for (let x = 0; x <= size; x += 3) {
      const y = yCenter + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 1.7 + phase * 1.3) * amp * 0.4;
      if (x === 0) ctx.moveTo(x, y - thickness * 0.5);
      else ctx.lineTo(x, y - thickness * 0.5);
    }
    for (let x = size; x >= 0; x -= 3) {
      const y = yCenter + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 1.7 + phase * 1.3) * amp * 0.4;
      ctx.lineTo(x, y + thickness);
    }
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, yCenter - thickness, 0, yCenter + thickness);
    grad.addColorStop(0, hexToRgba(color, 0));
    grad.addColorStop(0.35, hexToRgba(color, 0.5 + rand() * 0.25));
    grad.addColorStop(0.7, hexToRgba(color, 0.25));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Stars — some blurry (out-of-focus) ones for depth
  const starCount = 80 + Math.floor(rand() * 120);
  for (let i = 0; i < starCount; i++) {
    const x = rand() * size;
    const y = rand() * size * 0.6;
    const blurry = rand() < 0.35;
    const r = blurry ? rand() * 4 + 1.5 : rand() * 1.5 + 0.3;
    const alpha = blurry ? 0.15 + rand() * 0.25 : 0.5 + rand() * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }
  applyBloom(ctx, size, size * 0.015, 0.6);
  applyBloom(ctx, size, size * 0.05,  0.5);
  applyBloom(ctx, size, size * 0.13,  0.35);
  addGrain(ctx, size, rand, 0.08);
}

function drawLowPoly(ctx: CanvasRenderingContext2D, size: number, colors: string[], seed: number) {
  const rand = makeRng(seed);
  const grid = 9;
  const step = size / grid;
  const jitter = step * 0.42;

  const pts: { x: number; y: number }[] = [];
  for (let r = 0; r <= grid; r++) {
    for (let c = 0; c <= grid; c++) {
      pts.push({
        x: Math.max(0, Math.min(size, c * step + (rand() - 0.5) * jitter * 2)),
        y: Math.max(0, Math.min(size, r * step + (rand() - 0.5) * jitter * 2)),
      });
    }
  }

  const get = (r: number, c: number) => pts[r * (grid + 1) + c];

  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const tl = get(r, c), tr = get(r, c + 1), bl = get(r + 1, c), br = get(r + 1, c + 1);
      const t1 = ((r + c) / (grid * 2) + rand() * 0.25);
      const t2 = Math.min(t1 + 0.12 + rand() * 0.1, 1);
      const ci1 = Math.min(Math.floor(t1 * (colors.length - 1)), colors.length - 2);
      const ci2 = Math.min(Math.floor(t2 * (colors.length - 1)), colors.length - 2);
      const color1 = lerpColor(colors[ci1], colors[ci1 + 1], (t1 * (colors.length - 1)) - ci1);
      const color2 = lerpColor(colors[ci2], colors[ci2 + 1], (t2 * (colors.length - 1)) - ci2);

      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y);
      ctx.closePath(); ctx.fillStyle = color1; ctx.fill();

      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y); ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
      ctx.closePath(); ctx.fillStyle = color2; ctx.fill();
    }
  }
  applyBloom(ctx, size, size * 0.012, 0.55);
  applyBloom(ctx, size, size * 0.05,  0.7);
  applyBloom(ctx, size, size * 0.14,  0.45);
  addGrain(ctx, size, rand, 0.12);
}

function drawOrbs(ctx: CanvasRenderingContext2D, size: number, colors: string[], seed: number) {
  const rand = makeRng(seed);
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, size, size);

  // Background ambient glow
  const ambient = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.75);
  ambient.addColorStop(0, hexToRgba(colors[1], 0.25));
  ambient.addColorStop(1, hexToRgba(colors[0], 0));
  ctx.fillStyle = ambient;
  ctx.fillRect(0, 0, size, size);

  // Large background orbs
  for (let i = 0; i < 4; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.2 + rand() * 0.32);
    const color = colors[1 + (i % (colors.length - 1))];
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, hexToRgba(color, 0.28 + rand() * 0.15));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  // Bokeh circles
  const orbCount = 18 + Math.floor(rand() * 18);
  for (let i = 0; i < orbCount; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.018 + rand() * 0.07);
    const color = colors[Math.floor(rand() * colors.length)];
    const alpha = 0.15 + rand() * 0.3;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, hexToRgba(color, alpha));
    grad.addColorStop(0.5, hexToRgba(color, alpha * 0.4));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  }

  // Bright specular highlights
  for (let i = 0; i < 10; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.004 + rand() * 0.016);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, hexToRgba(colors[colors.length - 1], 0.95));
    grad.addColorStop(1, hexToRgba(colors[colors.length - 1], 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
  }
  applyBloom(ctx, size, size * 0.015, 0.6);
  applyBloom(ctx, size, size * 0.055, 0.55);
  applyBloom(ctx, size, size * 0.14,  0.4);
  addGrain(ctx, size, rand, 0.09);
}

function drawLines(ctx: CanvasRenderingContext2D, size: number, colors: string[], seed: number) {
  const rand = makeRng(seed);
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, colors[0]); bg.addColorStop(1, colors[1]);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);

  const lineCount = 32 + Math.floor(rand() * 22);
  const freq1 = 0.0022 + rand() * 0.003;
  const freq2 = 0.005  + rand() * 0.003;
  const phase1 = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const amp = size * (0.055 + rand() * 0.07);

  for (let i = 0; i < lineCount; i++) {
    const t = i / lineCount;
    const y0 = t * size;
    const ci = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
    const cf = t * (colors.length - 1) - ci;
    const lineColor = lerpColor(colors[Math.min(ci + 1, colors.length - 1)], colors[Math.min(ci + 2, colors.length - 1)], cf);
    ctx.beginPath();
    for (let x = 0; x <= size; x += 2) {
      const y = y0 + Math.sin(x * freq1 + phase1 + t * 2.5) * amp + Math.sin(x * freq2 + phase2) * amp * 0.38;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hexToRgba(lineColor, 0.22 + rand() * 0.38);
    ctx.lineWidth = 0.5 + rand() * 2;
    ctx.stroke();
  }

  // Depth vignette
  const cx = size * 0.5, cy = size * 0.5;
  const vig = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.72);
  vig.addColorStop(0, hexToRgba(colors[colors.length - 1], 0.08));
  vig.addColorStop(1, hexToRgba(colors[0], 0.5));
  ctx.fillStyle = vig; ctx.fillRect(0, 0, size, size);
  applyBloom(ctx, size, size * 0.012, 0.6);
  applyBloom(ctx, size, size * 0.05,  0.5);
  applyBloom(ctx, size, size * 0.13,  0.38);
  addGrain(ctx, size, rand, 0.10);
}

function drawNoise(ctx: CanvasRenderingContext2D, size: number, colors: string[], seed: number) {
  const rand = makeRng(seed);
  ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, size, size);

  // Large diagonal flows
  for (let w = 0; w < 6; w++) {
    const color = colors[w % colors.length];
    const angle = rand() * Math.PI;
    const cx = rand() * size, cy = rand() * size;
    const x2 = cx + Math.cos(angle) * size, y2 = cy + Math.sin(angle) * size;
    const grad = ctx.createLinearGradient(cx - Math.cos(angle) * size * 0.5, cy - Math.sin(angle) * size * 0.5, x2, y2);
    grad.addColorStop(0, hexToRgba(color, 0));
    grad.addColorStop(0.5, hexToRgba(color, 0.38 + rand() * 0.28));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
  }

  // Medium radial color blobs
  for (let i = 0; i < 22; i++) {
    const x = rand() * size, y = rand() * size;
    const r = size * (0.05 + rand() * 0.18);
    const color = colors[Math.floor(rand() * colors.length)];
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, hexToRgba(color, 0.28 + rand() * 0.2));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
  }

  // Pixel noise
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const noiseRng = makeRng(seed + 9999);
  for (let i = 0; i < d.length; i += 4) {
    const n = (noiseRng() - 0.5) * 52;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function drawCover(ctx: CanvasRenderingContext2D, size: number, style: StyleId, colors: string[], seed: number) {
  ctx.clearRect(0, 0, size, size);
  switch (style) {
    case "mesh":    drawMesh(ctx, size, colors, seed); break;
    case "aurora":  drawAurora(ctx, size, colors, seed); break;
    case "lowpoly": drawLowPoly(ctx, size, colors, seed); break;
    case "orbs":    drawOrbs(ctx, size, colors, seed); break;
    case "lines":   drawLines(ctx, size, colors, seed); break;
    case "noise":   drawNoise(ctx, size, colors, seed); break;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CoverGeneratorModal({ isOpen, onClose, onApply, projectName }: CoverGeneratorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [style, setStyle]       = useState<StyleId>("mesh");
  const [palette, setPalette]   = useState<PaletteId>("midnight");
  const [seed, setSeed]         = useState(() => Math.floor(Math.random() * 0x100000));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying]     = useState(false);
  const [thumbnails, setThumbnails]     = useState<Partial<Record<StyleId, string>>>({});

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSeed(Math.floor(Math.random() * 0x100000));
      setStyle("mesh");
      setPalette("midnight");
    }
  }, [isOpen]);

  // Render thumbnails when palette changes
  useEffect(() => {
    if (!isOpen) return;
    const colors = PALETTES.find(p => p.id === palette)!.colors;
    const thumbs: Partial<Record<StyleId, string>> = {};
    for (const s of STYLES) {
      const off = document.createElement("canvas");
      off.width = THUMB_SIZE; off.height = THUMB_SIZE;
      const ctx = off.getContext("2d");
      if (ctx) { drawCover(ctx, THUMB_SIZE, s.id, colors, THUMB_SEED); thumbs[s.id] = off.toDataURL(); }
    }
    setThumbnails(thumbs);
  }, [palette, isOpen]);

  // Render main canvas — keep canvas element stable (no key remount)
  useEffect(() => {
    if (!isOpen) return;
    const colors = PALETTES.find(p => p.id === palette)!.colors;
    setIsGenerating(true);
    const raf = requestAnimationFrame(() => {
      // Access ref inside rAF so we always get the current element
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawCover(ctx, CANVAS_SIZE, style, colors, seed);
      setIsGenerating(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [style, palette, seed, isOpen]);

  const handleApply = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || isApplying) return;
    setIsApplying(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/jpeg", 0.93),
      );
      const file = new File([blob], "generated-cover.jpg", { type: "image/jpeg" });
      await onApply(file);
      onClose();
    } finally {
      setIsApplying(false);
    }
  }, [onApply, onClose, isApplying]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[1000] bg-black/75"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            className="fixed inset-0 z-[1001] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="relative w-full max-w-xl pointer-events-auto rounded-[34px] border border-[#292828] shadow-2xl overflow-hidden flex flex-col"
              style={{ background: "linear-gradient(0deg, #151515 0%, #1D1D1D 100%)" }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3 p-5 pb-4">
                <Button size="icon-lg" onClick={onClose} aria-label="Back">
                  <ChevronLeft className="size-5" />
                </Button>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white leading-tight">Cover Studio</h2>
                  <p className="text-sm text-muted-foreground truncate">{projectName}</p>
                </div>
              </div>

              {/* Canvas preview */}
              <div className="px-5">
                <div className="relative aspect-square w-full rounded-2xl overflow-hidden ring-1 ring-white/10 bg-[#0a0a0a]">
                  <canvas
                    ref={canvasRef}
                    width={CANVAS_SIZE}
                    height={CANVAS_SIZE}
                    className={cn(
                      "w-full h-full transition-opacity duration-200",
                      isGenerating ? "opacity-50" : "opacity-100",
                    )}
                  />
                  <AnimatePresence>
                    {isGenerating && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <LoaderCircle className="size-6 text-white/60 animate-spin" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Style selector */}
              <div className="px-5 pt-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">Style</p>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                  {STYLES.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id)}
                      className={cn(
                        "flex-none flex flex-col items-center gap-1.5 p-1.5 rounded-2xl transition-all duration-200",
                        style === s.id
                          ? "bg-white/10 ring-1 ring-white/25"
                          : "hover:bg-white/5",
                      )}
                    >
                      <div className={cn(
                        "w-14 h-14 rounded-xl overflow-hidden ring-1 transition-all duration-200",
                        style === s.id ? "ring-white/40" : "ring-white/10",
                      )}>
                        {thumbnails[s.id]
                          ? <img src={thumbnails[s.id]} className="w-full h-full" draggable={false} />
                          : <div className="w-full h-full bg-white/5" />
                        }
                      </div>
                      <span className={cn(
                        "text-[10px] font-medium transition-colors",
                        style === s.id ? "text-white" : "text-muted-foreground",
                      )}>
                        {s.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Palette selector */}
              <div className="px-5 pt-4 pb-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">Palette</p>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                  {PALETTES.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPalette(p.id)}
                      title={p.name}
                      className={cn(
                        "flex-none flex flex-col items-center gap-1.5 p-1.5 rounded-xl transition-all duration-200",
                        palette === p.id
                          ? "bg-white/10 ring-1 ring-white/25"
                          : "hover:bg-white/5",
                      )}
                    >
                      <div className="flex h-7 w-16 overflow-hidden rounded-lg ring-1 ring-white/10">
                        {p.colors.map(c => (
                          <div key={c} className="flex-1 h-full" style={{ background: c }} />
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        {palette === p.id && <Check className="size-2.5 text-white" />}
                        <span className={cn(
                          "text-[10px] font-medium transition-colors",
                          palette === p.id ? "text-white" : "text-muted-foreground",
                        )}>
                          {p.name}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setSeed(Math.floor(Math.random() * 0x100000))}
                  disabled={isApplying}
                  haptic="selection"
                >
                  <Shuffle className="size-4 mr-2" />
                  Shuffle
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleApply}
                  disabled={isApplying || isGenerating}
                  haptic="medium"
                >
                  {isApplying ? (
                    <><LoaderCircle className="size-4 mr-2 animate-spin" />Applying…</>
                  ) : (
                    "Apply to Project"
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
