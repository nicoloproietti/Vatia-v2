export default function VatiaBuddy({ size = 120, className = '' }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 180 180" fill="none" role="img" aria-label="Vatia, assistente dello studio">
    <defs>
      <linearGradient id="buddy-body" x1="34" y1="35" x2="146" y2="155" gradientUnits="userSpaceOnUse">
        <stop stopColor="#22b8a5" /><stop offset="1" stopColor="#087f72" />
      </linearGradient>
      <filter id="buddy-shadow" x="15" y="20" width="150" height="150" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#073f39" floodOpacity=".16" />
      </filter>
    </defs>
    <ellipse cx="90" cy="157" rx="48" ry="9" fill="#0f8f80" opacity=".12" />
    <path d="M91 38C91 19 105 10 125 10c0 20-12 31-34 28Z" fill="#66c98f" />
    <path d="M91 38c11-11 20-17 31-23" stroke="#087f72" strokeWidth="3" strokeLinecap="round" />
    <g filter="url(#buddy-shadow)">
      <rect x="33" y="35" width="114" height="116" rx="38" fill="url(#buddy-body)" />
      <path d="M48 61c7-11 18-17 31-19" stroke="white" strokeOpacity=".24" strokeWidth="6" strokeLinecap="round" />
      <circle cx="67" cy="82" r="6" fill="#123c3a" /><circle cx="113" cy="82" r="6" fill="#123c3a" />
      <circle cx="69" cy="80" r="2" fill="white" /><circle cx="115" cy="80" r="2" fill="white" />
      <path d="M72 105c10 10 26 10 36 0" stroke="white" strokeWidth="5" strokeLinecap="round" />
      <path d="M58 130 90 145l32-15" stroke="#a8f0d8" strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <path d="M32 92c-13 1-19 8-19 19" stroke="#0f8f80" strokeWidth="7" strokeLinecap="round" />
    <circle cx="13" cy="114" r="6" fill="#22b8a5" />
    <path d="M148 92c13 1 19 8 19 19" stroke="#0f8f80" strokeWidth="7" strokeLinecap="round" />
    <circle cx="167" cy="114" r="6" fill="#22b8a5" />
  </svg>
}
