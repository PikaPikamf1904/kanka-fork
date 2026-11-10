/** Original night-sky banner: three moons over a mountain ridge. Pure SVG, no external art. */
export function BannerArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1026" />
          <stop offset="0.6" stopColor="#1c2350" />
          <stop offset="1" stopColor="#3a2c4f" />
        </linearGradient>
        <radialGradient id="moon-silver" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9d3e6" />
        </radialGradient>
        <radialGradient id="moon-red" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ff9a7a" />
          <stop offset="1" stopColor="#b8322a" />
        </radialGradient>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f6e7b0" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f6e7b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1200" height="300" fill="url(#sky)" />
      {Array.from({ length: 70 }, (_, i) => {
        const x = (i * 137.5) % 1200;
        const y = (i * 53.3) % 190;
        const r = (i % 5 === 0 ? 1.6 : 0.9);
        return <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={0.35 + (i % 4) * 0.15} />;
      })}
      <circle cx="930" cy="80" r="90" fill="url(#glow)" />
      <circle cx="930" cy="80" r="34" fill="url(#moon-silver)" />
      <circle cx="1040" cy="120" r="20" fill="url(#moon-red)" />
      <circle cx="860" cy="135" r="13" fill="#0b1026" stroke="#6b5f8f" strokeWidth="1.5" />
      <path d="M0 300 L0 215 L90 170 L160 205 L240 140 L320 200 L400 160 L470 210 L560 130 L650 205 L720 175 L800 220 L880 160 L960 215 L1040 180 L1120 225 L1200 190 L1200 300 Z" fill="#141834" />
      <path d="M0 300 L0 250 L120 225 L210 255 L330 220 L450 260 L560 235 L690 265 L800 240 L930 268 L1050 245 L1200 262 L1200 300 Z" fill="#0d1028" />
      <path d="M556 130 L548 160 L564 160 Z M240 140 L232 166 L248 166 Z" fill="#e8edf7" opacity="0.5" />
    </svg>
  );
}
