import React, { createContext, useContext, useEffect, useState } from "react";
export type ThemePreference = "light" | "dark" | "system";
const ThemeContext = createContext<{ preference: ThemePreference; resolvedTheme: "light" | "dark"; setPreference: (value: ThemePreference) => void } | null>(null);
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, updatePreference] = useState<ThemePreference>(() => { try { const value = localStorage.getItem("flaregit.theme"); return value === "light" || value === "dark" ? value : "system"; } catch { return "system"; } });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolvedTheme = preference === "system" ? systemDark ? "dark" : "light" : preference;
  useEffect(() => { const media = window.matchMedia("(prefers-color-scheme: dark)"); const change = () => setSystemDark(media.matches); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", resolvedTheme === "dark"); document.documentElement.style.colorScheme = resolvedTheme; }, [resolvedTheme]);
  const setPreference = (value: ThemePreference) => { try { localStorage.setItem("flaregit.theme", value); } catch { /* Theme still works when browser storage is unavailable. */ } updatePreference(value); };
  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}
export function useTheme() { const theme = useContext(ThemeContext); if (!theme) throw new Error("ThemeProvider is required"); return theme; }

import { Button } from "@/components/ui/button";
import { Sun, Moon, Monitor } from "lucide-react";
export function ThemeSelector({ compact = false, hideLabel = false }: { compact?: boolean; hideLabel?: boolean }) {
  const { preference, setPreference } = useTheme();
  return <fieldset className="min-w-0"><legend className={compact || hideLabel ? "sr-only" : "text-[11px] text-muted-foreground mb-2"}>Appearance</legend><div className="flex gap-1">{([{ value: "light", Icon: Sun }, { value: "dark", Icon: Moon }, { value: "system", Icon: Monitor }] as const).map(({ value, Icon }) => <Button key={value} size={compact ? "icon" : "sm"} variant={preference === value ? "secondary" : "ghost"} className={compact ? "h-8 w-8" : "flex-1 px-2 text-[11px] capitalize gap-1.5"} aria-label={`${value[0]?.toUpperCase()}${value.slice(1)} theme`} title={`${value} theme`} aria-pressed={preference === value} onClick={() => setPreference(value)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{!compact && value}</Button>)}</div></fieldset>;
}

import { useRef } from "react";
import { Dialog, DialogClose, DialogHeader, DialogTitle } from "@/components/ui/dialog";
export function AppearanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return <Dialog open={open} onOpenChange={onOpenChange}><div ref={panel}><DialogClose onClick={() => onOpenChange(false)} /><DialogHeader><DialogTitle>Appearance</DialogTitle></DialogHeader><ThemeSelector hideLabel /><p className="mt-3 text-xs text-muted-foreground">System follows your device appearance.</p></div></Dialog>;
}
