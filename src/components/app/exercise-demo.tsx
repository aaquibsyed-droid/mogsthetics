"use client";

import { useSyncExternalStore } from "react";
import { POSES, type Pattern, type Pose } from "@/lib/training/guide";

const SEGMENTS: Array<(p: Pose) => Array<[number, number]>> = [
  (p) => [p.neck, p.hip],
  (p) => [p.hip, p.knee2 ?? p.knee, p.ankle2 ?? p.ankle],
  (p) => [p.neck, p.elbow2 ?? p.elbow, p.hand2 ?? p.hand],
  (p) => [p.hip, p.knee, p.ankle],
  (p) => [p.neck, p.elbow, p.hand],
];
const pts = (xs: Array<[number, number]>) => xs.map(([x, y]) => `${x},${y}`).join(" ");

function subscribe(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Looping side-view figure moving between the start and end position of an exercise. */
export function ExerciseDemo({ pattern, className }: { pattern: Pattern; className?: string }) {
  const still = useSyncExternalStore(subscribe, reducedMotion, () => true);
  const [a, b] = POSES[pattern];
  const dur = pattern === "cardio" ? "0.9s" : pattern === "plank" ? "3s" : "2.6s";
  const anim = (attr: string, from: string, to: string) =>
    still ? null : (
      <animate
        attributeName={attr}
        values={`${from};${to};${to};${from};${from}`}
        keyTimes="0;0.4;0.5;0.9;1"
        calcMode="spline"
        keySplines="0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1;0 0 1 1"
        dur={dur}
        repeatCount="indefinite"
      />
    );
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={`Animated ${pattern} demonstration`}>
      <line x1="6" y1="111" x2="114" y2="111" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" strokeLinecap="round" />
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        {SEGMENTS.map((seg, i) => (
          <polyline key={i} points={pts(seg(a))} strokeOpacity={i === 1 || i === 2 ? 0.45 : 1}>
            {anim("points", pts(seg(a)), pts(seg(b)))}
          </polyline>
        ))}
      </g>
      <circle cx={a.head[0]} cy={a.head[1]} r="7" fill="currentColor">
        {anim("cx", String(a.head[0]), String(b.head[0]))}
        {anim("cy", String(a.head[1]), String(b.head[1]))}
      </circle>
    </svg>
  );
}
