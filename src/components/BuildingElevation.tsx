import type { ReactElement } from "react";

/**
 * Blueprint-style elevation of a building site: a finished tower, a low annex,
 * a frame still going up and a tower crane lifting a beam. Windows light up
 * one by one on a slow loop.
 */

const GROUND = 430;
const FLOOR = 32;

/** Deterministic 0..1 value per window so the pattern is stable between renders. */
function hash(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type Block = { x: number; width: number; floors: number; cols: number };

const TOWER: Block = { x: 210, width: 160, floors: 10, cols: 4 };
const ANNEX: Block = { x: 90, width: 120, floors: 5, cols: 3 };

function Windows({ block, seed }: { block: Block; seed: number }) {
  const cells: ReactElement[] = [];
  const gap = block.width / block.cols;
  for (let f = 0; f < block.floors; f += 1) {
    for (let c = 0; c < block.cols; c += 1) {
      const id = seed + f * 10 + c;
      const r = hash(id);
      const x = block.x + c * gap + gap * 0.22;
      const y = GROUND - (f + 1) * FLOOR + 9;
      const w = gap * 0.56;
      const lit = r > 0.35;
      cells.push(
        <g key={id}>
          <rect x={x} y={y} width={w} height={15} fill="none" stroke="rgba(255,255,255,0.14)" />
          {lit ? (
            <rect
              x={x + 1}
              y={y + 1}
              width={w - 2}
              height={13}
              fill="#fbaa19"
              style={{
                opacity: 0,
                animation: `frx-window ${9 + r * 5}s ease-out ${(r * 7).toFixed(2)}s infinite`,
              }}
            />
          ) : null}
        </g>,
      );
    }
  }
  return <>{cells}</>;
}

function Floors({ block }: { block: Block }) {
  const top = GROUND - block.floors * FLOOR;
  return (
    <g stroke="rgba(255,255,255,0.32)" fill="none">
      <rect x={block.x} y={top} width={block.width} height={block.floors * FLOOR} />
      {Array.from({ length: block.floors - 1 }, (_, i) => (
        <line
          key={i}
          x1={block.x}
          x2={block.x + block.width}
          y1={GROUND - (i + 1) * FLOOR}
          y2={GROUND - (i + 1) * FLOOR}
          stroke="rgba(255,255,255,0.12)"
        />
      ))}
    </g>
  );
}

export function BuildingElevation({ className }: { className?: string }) {
  const towerTop = GROUND - TOWER.floors * FLOOR;
  const frameX = 370;
  const frameW = 110;
  const frameFloors = 7;

  return (
    <svg viewBox="0 0 600 460" className={className} aria-hidden fill="none">
      {/* Level markers, like the datum lines on a section drawing */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="rgba(255,255,255,0.35)">
        {[0, 2, 4, 6, 8, 10].map((lvl) => {
          const y = GROUND - lvl * FLOOR;
          return (
            <g key={lvl}>
              <line x1="30" x2="70" y1={y} y2={y} stroke="rgba(251,170,25,0.55)" />
              <path d={`M70 ${y} l-6 -4 v8 z`} fill="rgba(251,170,25,0.55)" />
              <text x="30" y={y - 5}>
                N.{String(lvl).padStart(2, "0")}
              </text>
            </g>
          );
        })}
        <line x1="70" x2="580" y1={towerTop} y2={towerTop} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 5" />
      </g>

      {/* Annex and finished tower */}
      <Floors block={ANNEX} />
      <Windows block={ANNEX} seed={100} />
      <Floors block={TOWER} />
      <Windows block={TOWER} seed={0} />
      {/* Rooftop plant */}
      <rect x={TOWER.x + 40} y={towerTop - 14} width={50} height={14} stroke="rgba(255,255,255,0.32)" />

      {/* Frame still under construction: columns, slabs, open top floors */}
      <g stroke="rgba(255,255,255,0.22)">
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={frameX + (i * frameW) / 3}
            x2={frameX + (i * frameW) / 3}
            y1={GROUND}
            y2={GROUND - frameFloors * FLOOR}
          />
        ))}
        {Array.from({ length: frameFloors }, (_, i) => (
          <line
            key={i}
            x1={frameX}
            x2={frameX + frameW}
            y1={GROUND - (i + 1) * FLOOR}
            y2={GROUND - (i + 1) * FLOOR}
            strokeWidth={i === frameFloors - 1 ? 2 : 1}
            stroke={i === frameFloors - 1 ? "rgba(251,170,25,0.8)" : undefined}
          />
        ))}
        {/* Cross bracing on the lower bays */}
        <path
          d={`M${frameX} ${GROUND} L${frameX + frameW / 3} ${GROUND - FLOOR} M${frameX + frameW / 3} ${GROUND} L${frameX} ${GROUND - FLOOR}`}
          stroke="rgba(255,255,255,0.14)"
        />
      </g>

      {/* Tower crane */}
      <g stroke="rgba(251,170,25,0.75)">
        <line x1="530" x2="530" y1={GROUND} y2="62" />
        <line x1="542" x2="542" y1={GROUND} y2="62" />
        <path
          d={Array.from({ length: 23 }, (_, i) => `M530 ${GROUND - i * 16} L542 ${GROUND - (i + 1) * 16}`).join(" ")}
          strokeWidth="0.75"
        />
        {/* Apex and tie lines */}
        <path d="M530 62 L536 34 L542 62" />
        <path d="M536 34 L330 62 M536 34 L585 62" strokeWidth="0.75" />
        {/* Jib and counter-jib */}
        <line x1="330" x2="585" y1="62" y2="62" strokeWidth="2" />
        <line x1="330" x2="530" y1="70" y2="70" strokeWidth="0.75" />
        <path
          d={Array.from({ length: 12 }, (_, i) => `M${334 + i * 16} 70 L${342 + i * 16} 62`).join(" ")}
          strokeWidth="0.6"
        />
        <rect x="562" y="64" width="20" height="14" fill="rgba(251,170,25,0.25)" />
        {/* Operator cab */}
        <rect x="543" y="66" width="12" height="12" />
      </g>
      {/* Trolley, hoist line and the beam being lifted */}
      <g>
        <rect x="410" y="60" width="12" height="7" fill="#fbaa19" />
        <line x1="416" x2="416" y1="67" y2="168" stroke="rgba(255,255,255,0.45)" strokeWidth="0.75" />
        <path d="M410 168 L416 160 L422 168" stroke="rgba(255,255,255,0.45)" strokeWidth="0.75" />
        <rect x="380" y="168" width="72" height="6" fill="#fbaa19" />
      </g>

      {/* Ground */}
      <line x1="20" x2="600" y1={GROUND} y2={GROUND} stroke="rgba(255,255,255,0.5)" />
      <path
        d={Array.from({ length: 36 }, (_, i) => `M${24 + i * 16} ${GROUND + 10} L${34 + i * 16} ${GROUND}`).join(" ")}
        stroke="rgba(255,255,255,0.12)"
      />
    </svg>
  );
}
