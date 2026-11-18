import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export type NukeStage = 'idle' | 'countdown' | 'missile' | 'flash' | 'explosion' | 'emp-blackout' | 'aftermath';

interface NuclearFalloutProps {
  stage: NukeStage;
  onComplete?: () => void;
  center?: { x: number; y: number };
}

interface PixelPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetRadius: number;
  kind: 'fireball' | 'cap' | 'torus' | 'stem' | 'surge' | 'ember';
  heat: number; // 1.0 -> 0.0
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  swirlSign: number;
}

interface PixelTrail {
  x: number;
  y: number;
  size: number;
  life: number;
}

const PIXEL_SIZE = 8;

const snap = (v: number, step = PIXEL_SIZE) => Math.floor(v / step) * step;

const samplePixelColor = (heat: number): string => {
  const h = Math.max(0, Math.min(1, heat));
  if (h > 0.84) return '#ffffff';
  if (h > 0.68) return '#fef08a';
  if (h > 0.50) return '#fb923c';
  if (h > 0.34) return '#ef4444';
  if (h > 0.20) return '#991b1b';
  if (h > 0.10) return '#57534e';
  return '#292524';
};

function drawPixelDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  ditherRatio = 1
) {
  const rBlocks = Math.max(1, Math.round(radius / PIXEL_SIZE));
  const sx = snap(cx);
  const sy = snap(cy);
  ctx.fillStyle = color;

  for (let dy = -rBlocks; dy <= rBlocks; dy++) {
    for (let dx = -rBlocks; dx <= rBlocks; dx++) {
      if (dx * dx + dy * dy <= rBlocks * rBlocks + 0.35) {
        if (ditherRatio < 1 && ((Math.abs(dx + dy) % 2 === 1) && ditherRatio < 0.65)) {
          continue;
        }
        ctx.fillRect(sx + dx * PIXEL_SIZE, sy + dy * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      }
    }
  }
}

function drawPixelRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string
) {
  if (radius < PIXEL_SIZE) return;
  const sx = snap(cx);
  const sy = snap(cy);
  const steps = Math.max(24, Math.min(140, Math.floor((2 * Math.PI * radius) / PIXEL_SIZE)));
  ctx.fillStyle = color;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const px = snap(sx + Math.cos(a) * radius);
    const py = snap(sy + Math.sin(a) * radius);
    ctx.fillRect(px, py, PIXEL_SIZE, PIXEL_SIZE);
  }
}

export const NuclearFallout: React.FC<NuclearFalloutProps> = ({ stage, center }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const particlesRef = useRef<PixelPuff[]>([]);
  const trailRef = useRef<PixelTrail[]>([]);
  const rafRef = useRef<number | undefined>(undefined);
  const stageStartRef = useRef<number>(0);
  const explosionStartRef = useRef<number>(0);

  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
  });

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const getAudioCtx = (): AudioContext | null => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  };

  // Retro 8-bit square-wave missile whistle
  const playIncomingSfx = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.72);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.004, now + 0.75);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.78);
  };

  const playThermalCrackSfx = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.18);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  };

  // Bitcrushed 8-bit explosion roar
  const playDetonationSfx = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const dur = 2.2;
    const sampleLen = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, sampleLen, ctx.sampleRate);
    const out = buf.getChannelData(0);
    let hold = 0;
    const holdSamples = 14; // stepped retro 8-bit sample-and-hold crunch
    for (let i = 0; i < sampleLen; i++) {
      if (i % holdSamples === 0) {
        hold = Math.round((Math.random() * 2 - 1) * 4) / 4;
      }
      const env = Math.exp(-i / (ctx.sampleRate * 0.75));
      out[i] = hold * env * 0.65;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(950, now);
    lp.frequency.exponentialRampToValueAtTime(140, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  };

  const groundX = snap(center?.x ?? viewport.width / 2);
  const groundY = snap(Math.min(viewport.height - 24, Math.max(viewport.height * 0.45, center?.y ?? viewport.height * 0.85)));

  const spawnDetonation = () => {
    const items: PixelPuff[] = [];

    // 1. Pixel Fireball Core
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2.2;
      items.push({
        x: groundX + (Math.random() - 0.5) * 16,
        y: groundY - 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5 - 1.1,
        radius: 16,
        targetRadius: 40 + Math.random() * 24,
        kind: 'fireball',
        heat: 1.0,
        life: 0,
        maxLife: 1.8 + Math.random() * 0.7,
        gravity: -0.02,
        drag: 0.94,
        swirlSign: Math.random() > 0.5 ? 1 : -1,
      });
    }

    // 2. Pixel Ground Base-Surge
    for (let i = 0; i < 18; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      items.push({
        x: groundX + dir * (6 + Math.random() * 10),
        y: groundY - PIXEL_SIZE,
        vx: (2.4 + Math.random() * 7.0) * dir,
        vy: -Math.random() * 0.6,
        radius: 9,
        targetRadius: 15 + Math.random() * 10,
        kind: 'surge',
        heat: 0.65,
        life: 0,
        maxLife: 1.9 + Math.random() * 0.8,
        gravity: -0.004,
        drag: 0.93,
        swirlSign: dir,
      });
    }

    // 3. Pixel Sparks & Fallout Debris
    for (let i = 0; i < 64; i++) {
      const angle = -Math.PI * (0.05 + Math.random() * 0.9);
      const speed = 3.5 + Math.random() * 11;
      items.push({
        x: groundX + (Math.random() - 0.5) * 24,
        y: groundY - 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: PIXEL_SIZE,
        targetRadius: PIXEL_SIZE,
        kind: 'ember',
        heat: 0.9,
        life: 0,
        maxLife: 1.4 + Math.random() * 1.4,
        gravity: 0.2,
        drag: 0.97,
        swirlSign: 1,
      });
    }

    particlesRef.current = items;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (stage === 'idle') {
      particlesRef.current = [];
      trailRef.current = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    ctx.imageSmoothingEnabled = false;

    stageStartRef.current = performance.now();

    if (stage === 'missile') {
      trailRef.current = [];
      playIncomingSfx();
    } else if (stage === 'flash') {
      playThermalCrackSfx();
    } else if (stage === 'explosion') {
      explosionStartRef.current = performance.now();
      spawnDetonation();
      playDetonationSfx();
    }

    let prevTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.008, (now - prevTime) / 1000));
      prevTime = now;

      const stageElapsed = (now - stageStartRef.current) / 1000;
      const blastElapsed = explosionStartRef.current > 0 ? (now - explosionStartRef.current) / 1000 : 0;

      ctx.clearRect(0, 0, viewport.width, viewport.height);
      ctx.imageSmoothingEnabled = false;

      // 1. 8-BIT PIXEL MISSILE DESCENT + TARGET CROSSHAIR
      if (stage === 'missile') {
        const dur = 0.85;
        const p = Math.min(1, stageElapsed / dur);
        const eased = p * p;
        const startX = snap(Math.min(viewport.width - 64, groundX + viewport.width * 0.24));
        const startY = -32;
        const mx = snap(startX + (groundX - startX) * eased, 4);
        const my = snap(startY + (groundY - startY) * eased, 4);

        // Blinking retro pixel target crosshair at ground zero
        if (Math.floor(stageElapsed * 10) % 2 === 0) {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(groundX - 24, groundY - 4, 16, 4);
          ctx.fillRect(groundX + 8, groundY - 4, 16, 4);
          ctx.fillRect(groundX - 4, groundY - 24, 4, 16);
          ctx.fillRect(groundX - 4, groundY + 8, 4, 16);
          ctx.fillStyle = '#facc15';
          ctx.fillRect(groundX - 4, groundY - 4, 4, 4);
        }

        trailRef.current.push({ x: snap(mx), y: snap(my), size: PIXEL_SIZE, life: 1 });
        for (const dot of trailRef.current) {
          dot.life -= dt * 1.45;
          if (dot.life <= 0) continue;
          ctx.fillStyle = dot.life > 0.65 ? '#fef08a' : dot.life > 0.35 ? '#fb923c' : '#78716c';
          ctx.fillRect(dot.x - PIXEL_SIZE / 2, dot.y - PIXEL_SIZE / 2, PIXEL_SIZE, PIXEL_SIZE);
        }

        // Draw chunky 8-bit pixel warhead sprite
        const angle = Math.atan2(groundY - startY, groundX - startX);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle - Math.PI / 2);

        const U = 4; // 4px pixel sprite unit
        // Tail fins
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-3 * U, -5 * U, 2 * U, 2 * U);
        ctx.fillRect(U, -5 * U, 2 * U, 2 * U);
        // Fuselage
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-2 * U, -4 * U, 4 * U, 5 * U);
        ctx.fillStyle = '#475569';
        ctx.fillRect(-2 * U, -4 * U, U, 5 * U);
        // Hazard yellow band
        ctx.fillStyle = '#facc15';
        ctx.fillRect(-2 * U, 0, 4 * U, U);
        // Nose cone
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-2 * U, U, 4 * U, U);
        ctx.fillRect(-U, 2 * U, 2 * U, U);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 3 * U, U, U);
        // Flickering pixel thruster flame
        const flameH = Math.floor(stageElapsed * 24) % 2 === 0 ? 3 * U : 4 * U;
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(-U, -5 * U - flameH, 2 * U, flameH);
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(-U, -5 * U - Math.floor(flameH / 2), 2 * U, Math.floor(flameH / 2));

        ctx.restore();
      }

      // 2. 8-BIT PIXEL MUSHROOM CLOUD & AFTERMATH
      if (stage === 'explosion' || stage === 'emp-blackout' || stage === 'aftermath') {
        const isAftermath = stage === 'aftermath';
        const fadeStep = isAftermath ? Math.max(0, 1 - stageElapsed / 1.8) : 1;

        const riseMax = Math.min(viewport.height * 0.56, 400);
        const riseProgress = 1 - Math.pow(1 - Math.min(1, blastElapsed / 1.5), 2.4);
        const capCenterY = snap(groundY - 40 - riseProgress * riseMax);

        if (!isAftermath && blastElapsed < 1.9) {
          // Slender tapered pixel mushroom stem
          for (let i = 0; i < 2; i++) {
            const hRatio = Math.random();
            const taper = 1 - 0.35 * Math.sin(hRatio * Math.PI);
            particlesRef.current.push({
              x: groundX + (Math.random() - 0.5) * 6,
              y: groundY - hRatio * (groundY - capCenterY),
              vx: (Math.random() - 0.5) * 0.14,
              vy: -1.9 - Math.random() * 1.4,
              radius: 7 * taper,
              targetRadius: (10 + Math.random() * 4) * taper,
              kind: 'stem',
              heat: Math.max(0.12, 0.78 - blastElapsed * 0.28 + hRatio * 0.15),
              life: 0,
              maxLife: 1.5 + Math.random() * 0.7,
              gravity: -0.012,
              drag: 0.95,
              swirlSign: 1,
            });
          }

          // Pixel toroidal mushroom cap
          const capWidth = 48 + riseProgress * 116;
          const capHeight = 24 + riseProgress * 46;
          for (let i = 0; i < 4; i++) {
            const theta = Math.random() * Math.PI * 2;
            const px = groundX + Math.cos(theta) * capWidth * (0.35 + Math.random() * 0.65);
            const domeFlatten = Math.sin(theta) > 0 ? 0.3 : 0.95;
            const py = capCenterY + Math.sin(theta) * capHeight * domeFlatten;
            const isRim = Math.abs(Math.cos(theta)) > 0.6;
            particlesRef.current.push({
              x: px,
              y: py,
              vx: Math.cos(theta) * (isRim ? 1.4 : 0.6),
              vy: -0.5 + Math.sin(theta) * 0.35,
              radius: 16,
              targetRadius: 34 + Math.random() * 22,
              kind: isRim ? 'torus' : 'cap',
              heat: Math.max(0.08, 0.88 - blastElapsed * 0.34 - (isRim ? 0.12 : 0)),
              life: 0,
              maxLife: 1.8 + Math.random() * 0.9,
              gravity: -0.008,
              drag: 0.96,
              swirlSign: Math.cos(theta) >= 0 ? 1 : -1,
            });
          }
        }

        const nextParticles: PixelPuff[] = [];
        for (const pt of particlesRef.current) {
          pt.life += dt;
          if (pt.life >= pt.maxLife) continue;
          const progress = pt.life / pt.maxLife;

          if (pt.kind === 'torus') {
            pt.vx += pt.swirlSign * 0.04;
            pt.vy += progress > 0.4 ? 0.03 : -0.02;
          }

          pt.vx *= Math.pow(pt.drag, dt * 60);
          pt.vy *= Math.pow(pt.drag, dt * 60);
          pt.vy += pt.gravity * dt * 60;
          pt.x += pt.vx * dt * 60;
          pt.y += pt.vy * dt * 60;

          if (pt.kind === 'ember' && pt.y > groundY && pt.vy > 0) {
            pt.y = groundY;
            pt.vy *= -0.35;
            pt.vx *= 0.72;
          }

          pt.radius += (pt.targetRadius - pt.radius) * Math.min(1, dt * 3.5);
          pt.heat = Math.max(0, pt.heat - dt * (pt.kind === 'fireball' ? 0.42 : pt.kind === 'ember' ? 0.35 : 0.28));
          nextParticles.push(pt);
        }
        particlesRef.current = nextParticles;

        // Render pixel puffs (cool smoke first, hot plasma & embers after)
        for (const pt of nextParticles) {
          if (pt.kind === 'ember') continue;
          const lifeFrac = pt.life / pt.maxLife;
          const dither = Math.min(1, (1 - lifeFrac * 0.55) * fadeStep);
          if (dither <= 0.05) continue;
          const color = samplePixelColor(pt.heat);
          drawPixelDisc(ctx, pt.x, pt.y, pt.radius, color, dither);
        }

        for (const pt of nextParticles) {
          if (pt.kind !== 'ember') continue;
          ctx.fillStyle = samplePixelColor(pt.heat);
          ctx.fillRect(snap(pt.x), snap(pt.y), PIXEL_SIZE, PIXEL_SIZE);
        }

        // Expanding chunky pixel shockwave ring
        if (blastElapsed < 1.1) {
          const sp = blastElapsed / 1.1;
          const shockR = sp * Math.max(viewport.width, viewport.height) * 0.78;
          drawPixelRing(ctx, groundX, groundY - 8, shockR, sp < 0.35 ? '#ffffff' : '#fef08a');
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [stage, viewport, groundX, groundY]);

  return (
    <div
      className={`fixed inset-0 z-[9999] pointer-events-none overflow-hidden transition-opacity duration-300 ${
        stage === 'idle' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Crisp Stepped Retro Pixel Flash */}
      <AnimatePresence>
        {stage === 'flash' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.3, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, times: [0, 0.15, 0.35, 0.55, 1] }}
            className="absolute inset-0 bg-[#fef9c3] z-[10002]"
          />
        )}
      </AnimatePresence>

      {/* Main Retro Pixel-Grid Canvas with Stepped Impact Shake */}
      <motion.div
        animate={
          stage === 'explosion'
            ? {
                x: [0, -8, 8, -8, 8, -4, 4, 0],
                y: [0, 8, -8, 4, -4, 4, -4, 0],
              }
            : { x: 0, y: 0 }
        }
        transition={{ duration: 0.65, ease: 'linear' }}
        className="w-full h-full"
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full block pixel-canvas"
        />
      </motion.div>
    </div>
  );
};
