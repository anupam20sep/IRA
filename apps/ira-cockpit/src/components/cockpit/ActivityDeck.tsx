import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCockpit } from "@/store/cockpit";
import { cn } from "@/lib/utils";

export function ActivityDeck() {
  const deckOpen = useCockpit((s) => s.deckOpen);
  const setDeckOpen = useCockpit((s) => s.setDeckOpen);
  const logs = useCockpit((s) => s.logs);
  const interventions = useCockpit((s) => s.interventions);
  const approve = useCockpit((s) => s.approveIntervention);

  return (
    <div className="glass-panel overflow-hidden rounded-t-2xl border-b-0">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-left"
        onClick={() => setDeckOpen(!deckOpen)}
      >
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-ira-cyan" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            Activity deck
          </span>
          <Badge className="bg-ira-rose/20 text-ira-rose border-ira-rose/30">
            {interventions.length} needs you
          </Badge>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-slate-500 transition-transform",
            deckOpen ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {deckOpen ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 220, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className="overflow-hidden border-t border-ira-cyan/10"
          >
            <div className="grid h-[220px] grid-cols-[1.4fr_1fr] gap-0">
              <ScrollArea className="h-full border-r border-ira-cyan/10 px-4 py-3">
                <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
                  {logs.map((line) => (
                    <li key={line.id} className="flex gap-2">
                      <span className="shrink-0 text-slate-600">{line.ts}</span>
                      <span
                        className={cn(
                          "shrink-0 uppercase",
                          line.level === "ira" && "text-ira-cyan",
                          line.level === "info" && "text-slate-400",
                          line.level === "warn" && "text-ira-amber",
                          line.level === "error" && "text-ira-rose",
                        )}
                      >
                        [{line.source}]
                      </span>
                      <span className="text-slate-300">{line.message}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>

              <ScrollArea className="h-full px-4 py-3">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Intervention queue · Ask-Me
                </p>
                <ul className="flex flex-col gap-2">
                  {interventions.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-white/5 bg-black/40 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Badge
                          className={cn(
                            "text-[10px]",
                            item.severity === "critical"
                              ? "bg-ira-rose/20 text-ira-rose"
                              : "bg-ira-amber/20 text-ira-amber",
                          )}
                        >
                          {item.severity}
                        </Badge>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-7 text-ira-cyan hover:bg-ira-cyan/10"
                          onClick={() => approve(item.id)}
                        >
                          <Check data-icon="inline-start" />
                          Approve
                        </Button>
                      </div>
                      <p className="text-sm text-slate-100">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
                    </li>
                  ))}
                  {interventions.length === 0 ? (
                    <p className="text-xs text-slate-500">Nothing waiting on you.</p>
                  ) : null}
                </ul>
              </ScrollArea>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
