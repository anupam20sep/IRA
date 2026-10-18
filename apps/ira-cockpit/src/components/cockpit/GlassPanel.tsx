import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title?: string;
  eyebrow?: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
};

export function GlassPanel({ title, eyebrow, className, children, action }: Props) {
  return (
    <section className={cn("glass-panel rounded-2xl p-4", className)}>
      {(title || eyebrow || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ira-cyan/70">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="truncate text-sm font-medium tracking-wide text-slate-100">
                {title}
              </h2>
            ) : null}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
