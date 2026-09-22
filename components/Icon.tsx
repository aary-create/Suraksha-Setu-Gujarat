// One stroke weight, one corner treatment, one grid — so icons read as a set
// rather than as clip art collected from different places.
type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const ChevronDown = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}><path d="m6 9 6 6 6-6" /></svg>
);

export const Pin = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export const Crosshair = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const Search = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

export const Check = ({ size = 28, className }: Props) => (
  <svg {...base(size)} strokeWidth={2.25} className={className}><path d="m4.5 12.5 5 5 10-11" /></svg>
);

export const Info = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.5" />
  </svg>
);

export const Warning = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17v.5" />
  </svg>
);

export const Hospital = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 21V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" /><path d="M2 21h20" />
    <path d="M12 9v6M9 12h6" />
  </svg>
);

export const Phone = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M6.6 3h3l1.5 4-2 1.4a13 13 0 0 0 6.5 6.5l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3Z" />
  </svg>
);

export const Speaker = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" /><path d="M16 9a4.5 4.5 0 0 1 0 6" />
  </svg>
);

export const Shield = ({ size = 21, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M12 21s7-3.2 7-9V6l-7-3-7 3v6c0 5.8 7 9 7 9Z" />
  </svg>
);

export const Bell = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
    <path d="M10.3 19a2 2 0 0 0 3.4 0" />
  </svg>
);

export const Clock = ({ size = 21, className }: Props) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
);
