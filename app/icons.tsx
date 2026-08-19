type IconProps = {
  className?: string;
};

type IconName = "arrow" | "back" | "clipboard" | "history" | "home" | "plus" | "refresh";

export function Icon({ name, className }: IconProps & { name: IconName }) {
  const sharedProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    "aria-hidden": true,
  } as const;

  if (name === "clipboard") {
    return (
      <svg {...sharedProps}>
        <rect x="8" y="8" width="11" height="11" rx="1.5" />
        <path d="M16 8V5.8A1.8 1.8 0 0 0 14.2 4H5.8A1.8 1.8 0 0 0 4 5.8v8.4A1.8 1.8 0 0 0 5.8 16H8" />
      </svg>
    );
  }

  if (name === "arrow") {
    return (
      <svg {...sharedProps}>
        <path d="M5 12h13M13 6l6 6-6 6" />
      </svg>
    );
  }

  if (name === "back") {
    return (
      <svg {...sharedProps}>
        <path d="M19 12H5M11 18l-6-6 6-6" />
      </svg>
    );
  }

  if (name === "history") {
    return (
      <svg {...sharedProps}>
        <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg {...sharedProps}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg {...sharedProps}>
        <path d="M20 11a8 8 0 0 0-14.8-3L3 10M3 5v5h5M4 13a8 8 0 0 0 14.8 3L21 14m0 5v-5h-5" />
      </svg>
    );
  }

  return (
    <svg {...sharedProps}>
      <path d="M4 19.5V5.8A1.8 1.8 0 0 1 5.8 4h12.4A1.8 1.8 0 0 1 20 5.8v13.7" />
      <path d="M4 16h16M8 8h8M8 11h5" />
    </svg>
  );
}
