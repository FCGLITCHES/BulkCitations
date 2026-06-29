import React, { useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

type SafeResponsiveChartProps = {
  className?: string;
  minHeight?: number;
  children: React.ReactElement;
};

export function SafeResponsiveChart({
  className,
  minHeight = 180,
  children,
}: SafeResponsiveChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let frame = 0;
    const update = () => {
      const rect = host.getBoundingClientRect();
      const nextReady = rect.width > 0 && rect.height > 0;
      setIsReady(nextReady);
    };

    update();
    const observer = new ResizeObserver(() => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(update);
    });
    observer.observe(host);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={cn("min-w-0", className)}>
      {isReady ? (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={minHeight}>
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="h-full w-full" />
      )}
    </div>
  );
}
