type BingXLogoProps = {
  /** Display width/height in px */
  size?: number;
  className?: string;
};

/**
 * BingX-style blue mark used in API keys list.
 */
export function BingXLogo({ size = 40, className }: BingXLogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="bingx-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3158F3" />
          <stop offset="100%" stopColor="#456BFF" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#bingx-bg)" />
      <g transform="translate(24 24)">
        {/* Two mirrored ribbons centered at (24,24) to keep the mark perfectly aligned */}
        <path
          d="M-16 -11 C-8 -11 -3 -8 2 -2 C7 4 11 7 16 7 L16 11 C8 11 3 8 -2 2 C-7 -4 -11 -7 -16 -7 Z"
          fill="#F7F8FF"
        />
        <path
          d="M-16 11 C-8 11 -3 8 2 2 C7 -4 11 -7 16 -7 L16 -11 C8 -11 3 -8 -2 -2 C-7 4 -11 7 -16 7 Z"
          fill="#FFFFFF"
          fillOpacity="0.94"
        />
      </g>
    </svg>
  );
}
