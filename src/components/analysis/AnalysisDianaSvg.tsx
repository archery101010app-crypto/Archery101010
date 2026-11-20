"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AnalysisMarkedImpact,
  AnalysisShotRecord,
  NormalizedTargetPoint,
  evaluateNormalizedTargetImpact
} from "@/lib/scoring/shotAnalysisEngine";

interface AnalysisDianaSvgProps {
  shot?: AnalysisShotRecord | null;
  sizePx?: number;
  replayTrigger?: number;
  markMode?: boolean;
  onMarkImpact?: (impact: AnalysisMarkedImpact) => void;
  compactWatchMode?: boolean;
}

const CX = 120;
const CY = 120;
const OUTER_R = 115;

function toSvgCoord(pt: NormalizedTargetPoint): { x: number; y: number } {
  return {
    x: Number((CX + pt.x * OUTER_R).toFixed(2)),
    y: Number((CY + pt.y * OUTER_R).toFixed(2))
  };
}

function buildSmoothPath(points: NormalizedTargetPoint[]): string {
  if (!points || points.length === 0) return "";
  const mapped = points.map(toSvgCoord);
  if (mapped.length === 1) {
    return `M ${mapped[0].x} ${mapped[0].y}`;
  }
  if (mapped.length === 2) {
    return `M ${mapped[0].x} ${mapped[0].y} L ${mapped[1].x} ${mapped[1].y}`;
  }
  let d = `M ${mapped[0].x} ${mapped[0].y}`;
  for (let i = 1; i < mapped.length - 1; i++) {
    const midX = Number(((mapped[i].x + mapped[i + 1].x) / 2).toFixed(2));
    const midY = Number(((mapped[i].y + mapped[i + 1].y) / 2).toFixed(2));
    d += ` Q ${mapped[i].x} ${mapped[i].y}, ${midX} ${midY}`;
  }
  const last = mapped[mapped.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function interpolatePolyline(
  points: NormalizedTargetPoint[],
  progress01: number
): NormalizedTargetPoint[] {
  if (!points || points.length === 0) return [];
  if (progress01 <= 0) return [points[0]];
  if (progress01 >= 1 || points.length === 1) return points;

  const scaled = progress01 * (points.length - 1);
  const wholeIdx = Math.floor(scaled);
  const frac = scaled - wholeIdx;
  const sub = points.slice(0, wholeIdx + 1);
  if (wholeIdx + 1 < points.length && frac > 0) {
    const a = points[wholeIdx];
    const b = points[wholeIdx + 1];
    sub.push({
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac
    });
  }
  return sub;
}

export default function AnalysisDianaSvg({
  shot,
  sizePx = 312,
  replayTrigger = 0,
  markMode = false,
  onMarkImpact,
  compactWatchMode = false
}: AnalysisDianaSvgProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [replayProgress, setReplayProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!replayTrigger || !shot) {
      setReplayProgress(null);
      return;
    }

    const totalSec = Math.max(1.4, Math.min(7.5, (shot.prepSeconds || 1.5) + (shot.aimSeconds || 3.0)));
    const durationMs = totalSec * 1000;
    const startMs = performance.now();
    let rafId = 0;

    setReplayProgress(0);

    const step = (now: number) => {
      const t = Math.min(1, (now - startMs) / durationMs);
      setReplayProgress(t);
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        window.setTimeout(() => setReplayProgress(null), 350);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [replayTrigger, shot]);

  const renderedTrace = useMemo(() => {
    if (!shot) return null;
    const prepDur = Math.max(0.2, shot.prepSeconds || 1.5);
    const aimDur = Math.max(0.2, shot.aimSeconds || 3.0);
    const totalDur = prepDur + aimDur;
    const prepFraction = prepDur / totalDur;

    if (replayProgress === null) {
      return {
        prepPath: buildSmoothPath(shot.prepPoints),
        aimPath: buildSmoothPath(shot.aimPoints),
        cursor: null as { x: number; y: number; inAim: boolean } | null,
        showRelease: true
      };
    }

    if (replayProgress <= prepFraction) {
      const localP = prepFraction > 0 ? replayProgress / prepFraction : 1;
      const partialPrep = interpolatePolyline(shot.prepPoints, localP);
      const tip = partialPrep[partialPrep.length - 1] || shot.prepPoints[0];
      const svgTip = tip ? toSvgCoord(tip) : { x: CX, y: CY };
      return {
        prepPath: buildSmoothPath(partialPrep),
        aimPath: "",
        cursor: { x: svgTip.x, y: svgTip.y, inAim: false },
        showRelease: false
      };
    }

    const localAim = (replayProgress - prepFraction) / Math.max(0.001, 1 - prepFraction);
    const partialAim = interpolatePolyline(shot.aimPoints, localAim);
    const tip = partialAim[partialAim.length - 1] || shot.releasePoint;
    const svgTip = toSvgCoord(tip);
    return {
      prepPath: buildSmoothPath(shot.prepPoints),
      aimPath: buildSmoothPath(partialAim),
      cursor: { x: svgTip.x, y: svgTip.y, inAim: true },
      showRelease: localAim >= 0.99
    };
  }, [shot, replayProgress]);

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!markMode || !onMarkImpact || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const svgX = ((e.clientX - rect.left) / rect.width) * 240;
    const svgY = ((e.clientY - rect.top) / rect.height) * 240;
    const nx = (svgX - CX) / OUTER_R;
    const ny = (svgY - CY) / OUTER_R;
    onMarkImpact(evaluateNormalizedTargetImpact(nx, ny));
  };

  const relSvg = shot ? toSvgCoord(shot.releasePoint) : null;
  const impact = shot?.markedImpact || null;
  const impactSvg = impact ? toSvgCoord({ x: impact.x, y: impact.y }) : null;

  const impactFill = impact
    ? impact.ringNumber >= 9
      ? "#FFE500"
      : impact.ringNumber >= 7
      ? "#FF1E1E"
      : impact.ringNumber >= 5
      ? "#00BFFF"
      : "#FFFFFF"
    : "#FFE500";
  const impactTextFill =
    impact && (impact.ringNumber === 8 || impact.ringNumber === 7) ? "#FFFFFF" : "#000000";

  return (
    <svg
      ref={svgRef}
      width={sizePx}
      height={sizePx}
      viewBox="0 0 240 240"
      onPointerDown={handleSvgPointerDown}
      role="img"
      aria-label="Diana de análisis biomecánico"
      className={`select-none max-w-full h-auto ${
        markMode ? "cursor-crosshair ring-2 ring-[#FFE500]/70 rounded-full" : ""
      }`}
    >
      {/* Pure Pitch-Black OLED Instrument Base */}
      <circle
        cx="120"
        cy="120"
        r="115"
        fill="#020306"
        stroke="rgba(255,255,255,0.90)"
        strokeWidth="2.1"
      />

      {/* Precision Cardinal Axis Lines (Sunlight Visible, Broken Around Gold Core) */}
      <line x1="120" y1="5" x2="120" y2="92" stroke="rgba(255,255,255,0.20)" strokeWidth="1.0" />
      <line x1="120" y1="148" x2="120" y2="235" stroke="rgba(255,255,255,0.20)" strokeWidth="1.0" />
      <line x1="5" y1="120" x2="92" y2="120" stroke="rgba(255,255,255,0.20)" strokeWidth="1.0" />
      <line x1="148" y1="120" x2="235" y2="120" stroke="rgba(255,255,255,0.20)" strokeWidth="1.0" />

      {/* Cardinal Outer Ticks */}
      <line x1="120" y1="5" x2="120" y2="12" stroke="#FFFFFF" strokeWidth="1.9" />
      <line x1="120" y1="228" x2="120" y2="235" stroke="#FFFFFF" strokeWidth="1.9" />
      <line x1="5" y1="120" x2="12" y2="120" stroke="#FFFFFF" strokeWidth="1.9" />
      <line x1="228" y1="120" x2="235" y2="120" stroke="#FFFFFF" strokeWidth="1.9" />

      {/* White & Platinum Outer Rings (Zones 2, 3, 4 — Outdoor Sunlight Contrast) */}
      <circle cx="120" cy="120" r="103.5" fill="none" stroke="rgba(255,255,255,0.54)" strokeWidth="1.45" />
      <circle cx="120" cy="120" r="92.0" fill="none" stroke="#B8C4D8" strokeOpacity="0.72" strokeWidth="1.7" />
      <circle cx="120" cy="120" r="80.5" fill="none" stroke="#9AA8C0" strokeOpacity="0.50" strokeWidth="1.35" />

      {/* Official ARCHERY 101010 Cyan Rings (#00BFFF — Zones 5 & 6) */}
      <circle cx="120" cy="120" r="69.0" fill="rgba(0,191,255,0.05)" stroke="#00BFFF" strokeWidth="2.3" />
      <circle cx="120" cy="120" r="57.5" fill="none" stroke="#00BFFF" strokeOpacity="0.74" strokeWidth="1.5" />

      {/* Official ARCHERY 101010 Red Rings (#FF1E1E — Zones 7 & 8) */}
      <circle cx="120" cy="120" r="46.0" fill="rgba(255,30,30,0.06)" stroke="#FF1E1E" strokeWidth="2.4" />
      <circle cx="120" cy="120" r="34.5" fill="none" stroke="#FF1E1E" strokeOpacity="0.76" strokeWidth="1.55" />

      {/* Official ARCHERY 101010 Yellow Rings (#FFE500 — Zones 9, 10 & X) */}
      <circle cx="120" cy="120" r="23.0" fill="rgba(255,229,0,0.09)" stroke="#FFE500" strokeWidth="2.6" />
      <circle cx="120" cy="120" r="11.5" fill="none" stroke="#FFE500" strokeOpacity="0.94" strokeWidth="1.7" />

      {/* Precision Center Crosshair (+) */}
      <line x1="116.2" y1="120" x2="123.8" y2="120" stroke="#FFE500" strokeWidth="1.4" />
      <line x1="120" y1="116.2" x2="120" y2="123.8" stroke="#FFE500" strokeWidth="1.4" />

      {/* Preparatory Phase (White Dashed Path Over Dark Halo) */}
      {renderedTrace && renderedTrace.prepPath && (
        <>
          <path
            d={renderedTrace.prepPath}
            fill="none"
            stroke="#020306"
            strokeWidth="5.0"
            strokeLinecap="round"
          />
          <path
            d={renderedTrace.prepPath}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.94"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray="3.8 4.0"
          />
        </>
      )}

      {/* Aiming Phase (Cyan Solid Path Over Dark Halo) */}
      {renderedTrace && renderedTrace.aimPath && (
        <>
          <path
            d={renderedTrace.aimPath}
            fill="none"
            stroke="#020306"
            strokeWidth="5.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={renderedTrace.aimPath}
            fill="none"
            stroke="#00BFFF"
            strokeWidth="3.0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {/* Live Replay Sight Cursor */}
      {renderedTrace?.cursor && (
        <circle
          cx={renderedTrace.cursor.x}
          cy={renderedTrace.cursor.y}
          r="5.2"
          fill={renderedTrace.cursor.inAim ? "#00BFFF" : "#FFFFFF"}
          stroke="#020306"
          strokeWidth="2.1"
        />
      )}

      {/* Crisp Release Point (#FFFFFF) */}
      {relSvg && renderedTrace?.showRelease && (
        <circle
          cx={relSvg.x}
          cy={relSvg.y}
          r="5.0"
          fill="#FFFFFF"
          stroke="#020306"
          strokeWidth="2.1"
        />
      )}

      {/* Real Marked Impact Pin (Only on Phone / Coach Views) */}
      {!compactWatchMode && impact && impactSvg && renderedTrace?.showRelease && (
        <g>
          <circle
            cx={impactSvg.x}
            cy={impactSvg.y}
            r="7.8"
            fill={impactFill}
            stroke="#020306"
            strokeWidth="2.0"
          />
          <text
            x={impactSvg.x}
            y={impactSvg.y + 3.3}
            textAnchor="middle"
            fontSize="9.6"
            fontWeight="900"
            fill={impactTextFill}
            fontFamily="Outfit, sans-serif"
          >
            {shot?.shotNumber || 1}
          </text>
        </g>
      )}
    </svg>
  );
}
