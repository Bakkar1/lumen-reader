/** Lumen Reader's own icon set, drawn on a 20×20 grid (D10). */

const Svg = ({ children, viewBox = '0 0 20 20' }: { children: preact.ComponentChildren; viewBox?: string }) => (
  <svg viewBox={viewBox} aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const PlayIcon = () => (
  <Svg>
    <path d="M6.5 4.2c0-.8.9-1.3 1.6-.9l8.2 5c.7.4.7 1.4 0 1.8l-8.2 5c-.7.4-1.6-.1-1.6-.9z" />
  </Svg>
);

export const PauseIcon = () => (
  <Svg>
    <rect x="5" y="4" width="3.6" height="12" rx="1.2" />
    <rect x="11.4" y="4" width="3.6" height="12" rx="1.2" />
  </Svg>
);

export const SkipBackIcon = () => (
  <Svg>
    <rect x="4" y="4.5" width="2.2" height="11" rx="1" />
    <path d="M15.5 5.3v9.4c0 .7-.8 1.1-1.4.7L8 10.7a.9.9 0 0 1 0-1.4l6.1-4.7c.6-.4 1.4 0 1.4.7z" />
  </Svg>
);

export const SkipForwardIcon = () => (
  <Svg>
    <rect x="13.8" y="4.5" width="2.2" height="11" rx="1" />
    <path d="M4.5 5.3v9.4c0 .7.8 1.1 1.4.7l6.1-4.7a.9.9 0 0 0 0-1.4L5.9 4.6c-.6-.4-1.4 0-1.4.7z" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
  </Svg>
);

export const CollapseIcon = () => (
  <Svg>
    <path d="M8 5l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  </Svg>
);

export const MinusIcon = () => (
  <Svg>
    <path d="M5 10h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </Svg>
);

export const PlusIcon = () => (
  <Svg>
    <path d="M5 10h10M10 5v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </Svg>
);

/** Two rows of three dots: "this can be moved". */
export const GripIcon = () => (
  <Svg viewBox="0 0 16 8">
    {[2, 8, 14].flatMap((x) => [2, 6].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}
  </Svg>
);

/** An arrow back towards the page text. */
export const ReturnIcon = () => (
  <Svg>
    <path d="M15 10H5.5M9.5 6l-4 4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  </Svg>
);
