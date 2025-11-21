import { Effect } from "effect";

/**
 * Skeleton component for loading states
 */

export type SkeletonVariant = "entry" | "project" | "text" | "circle" | "rect";

export type SkeletonConfig = {
  variant: SkeletonVariant;
  count?: number;
  className?: string;
};

const SIZE_REGEX = /\d+/;

/**
 * Creates a skeleton entry card HTML
 */
const entrySkeleton = (): string => `
  <div class="p-4 border border-border rounded-lg animate-pulse">
    <div class="flex justify-between items-center">
      <div class="flex-1 space-y-2">
        <div class="h-4 bg-muted rounded w-24"></div>
        <div class="h-3 bg-muted rounded w-32"></div>
        <div class="h-3 bg-muted rounded w-32"></div>
      </div>
      <div class="flex items-center gap-4">
        <div class="h-6 bg-muted rounded w-12"></div>
        <div class="flex items-center gap-2">
          <div class="h-8 w-8 bg-muted rounded-full"></div>
          <div class="h-8 w-8 bg-muted rounded-full"></div>
        </div>
      </div>
    </div>
  </div>
`;

/**
 * Creates a skeleton project card HTML
 */
const projectSkeleton = (): string => `
  <div class="p-4 border border-border rounded-lg animate-pulse">
    <div class="flex justify-between items-center">
      <div class="h-6 bg-muted rounded w-32"></div>
      <div class="flex items-center gap-2">
        <div class="h-8 w-8 bg-muted rounded-full"></div>
        <div class="h-8 w-8 bg-muted rounded-full"></div>
      </div>
    </div>
  </div>
`;

/**
 * Creates a generic text skeleton
 */
const textSkeleton = (className = ""): string => `
  <div class="h-4 bg-muted rounded animate-pulse ${className}"></div>
`;

/**
 * Creates a circle skeleton
 */
const circleSkeleton = (size = 16, className = ""): string => `
  <div class="bg-muted rounded-full animate-pulse ${className}" style="width: ${size}px; height: ${size}px;"></div>
`;

/**
 * Creates a rectangle skeleton
 */
const rectSkeleton = (
  width = "100%",
  height = "1rem",
  className = ""
): string => `
  <div class="bg-muted rounded animate-pulse ${className}" style="width: ${width}; height: ${height};"></div>
`;

/**
 * Generates skeleton HTML based on variant
 */
const generateSkeleton = (config: SkeletonConfig): string => {
  const { variant, count = 1, className = "" } = config;

  switch (variant) {
    case "entry": {
      return Array.from({ length: count }, () => entrySkeleton()).join("");
    }
    case "project": {
      return Array.from({ length: count }, () => projectSkeleton()).join("");
    }
    case "text": {
      return Array.from({ length: count }, () => textSkeleton(className)).join(
        ""
      );
    }
    case "circle": {
      const size = Number.parseInt(
        className.match(SIZE_REGEX)?.[0] || "16",
        10
      );
      return Array.from({ length: count }, () =>
        circleSkeleton(size, className)
      ).join("");
    }
    case "rect": {
      return Array.from({ length: count }, () =>
        rectSkeleton("100%", "1rem", className)
      ).join("");
    }
    default: {
      return textSkeleton(className);
    }
  }
};

/**
 * Renders skeleton loading state
 */
export const renderSkeleton = (config: SkeletonConfig): Effect.Effect<string> =>
  Effect.sync(() => generateSkeleton(config));

/**
 * Shows skeleton loading state in a container element
 */
export const showSkeleton = (
  containerId: string,
  config: SkeletonConfig
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const container = document.getElementById(containerId);
    if (!container) {
      yield* Effect.logError(`Container with id "${containerId}" not found`);
      return;
    }
    const skeletonHTML = yield* renderSkeleton(config);
    container.innerHTML = skeletonHTML;
  });
