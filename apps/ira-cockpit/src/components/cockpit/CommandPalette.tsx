import { useEffect } from "react";
import {
  FolderKanban,
  Home,
  Lightbulb,
  Moon,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useCockpit } from "@/store/cockpit";

export function CommandPalette() {
  const open = useCockpit((s) => s.commandOpen);
  const setOpen = useCockpit((s) => s.setCommandOpen);
  const setAway = useCockpit((s) => s.setAway);
  const setRoute = useCockpit((s) => s.setRoute);
  const openProject = useCockpit((s) => s.openProject);
  const projects = useCockpit((s) => s.projects);
  const setPrompt = useCockpit((s) => s.setPrompt);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Jump to project, brainstorm, setup…" />
        <CommandList>
          <CommandEmpty>No match.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem
              onSelect={() => {
                setRoute("home");
                setOpen(false);
              }}
            >
              <Home />
              Home / brief
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setRoute("brainstorm");
                setOpen(false);
              }}
            >
              <Lightbulb />
              Brainstorm
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setRoute("setup");
                setOpen(false);
              }}
            >
              <Settings2 />
              Setup agents & skills
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPrompt("status brief");
                setOpen(false);
              }}
            >
              <Sparkles />
              Ask Ira for status
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setAway(true);
                setOpen(false);
              }}
            >
              <Moon />
              Engage away
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                onSelect={() => {
                  openProject(p.id);
                  setOpen(false);
                }}
              >
                <FolderKanban />
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
