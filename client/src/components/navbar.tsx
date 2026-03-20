import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Quote, Menu, Moon, Sun, FileText, History, Info, LogIn, LogOut, LineChart, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";

export function Navbar() {
  const [navOpen, setNavOpen] = useState(false);
  const { isAdmin, isConfigured, isInitialized, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains("dark") ||
      localStorage.getItem("theme") === "dark";
    setIsDark(isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    if (nextTheme) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const handleLogout = () => {
    void logout().finally(() => {
      setLocation("/");
    });
  };

  return (
    <header className="bg-background/90 backdrop-blur-lg border-b border-border shadow-sm sticky top-0 z-50 transition-colors duration-300">
      <div className="container mx-auto px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center space-x-3 group min-w-0">
            <div className="w-10 h-10 bg-gradient-brand rounded-xl flex items-center justify-center shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
              <Quote className="text-white text-lg" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-lg font-extrabold text-foreground tracking-tight truncate">BulkReferences</h1>
              <Badge variant="secondary" className="text-[10px] uppercase font-bold text-white bg-primary hover:bg-primary/90 hidden sm:inline-flex">Beta</Badge>
            </div>
          </Link>

          <nav className="hidden md:flex items-center space-x-6">
            <Link href="/#converter" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer">Converter</Link>
            <Link href="/history" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer">History</Link>
            <Link href="/about" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer">About</Link>
            <Link href="/contact" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer">Contact</Link>

            {isInitialized ? (
              isAdmin ? (
                <>
                  <Link href="/admin/reports" className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors cursor-pointer">Admin Mode</Link>
                  <button onClick={handleLogout} className="text-sm font-medium text-destructive hover:text-destructive/80 transition-colors cursor-pointer border px-3 py-1.5 rounded bg-muted/30">Logout</button>
                </>
              ) : isConfigured ? (
                <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors cursor-pointer">Login</Link>
              ) : null
            ) : null}
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full w-8 h-8 ml-2" title="Toggle theme">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="sr-only">Toggle theme</span>
            </Button>
          </nav>

          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <div className="flex items-center gap-2 md:hidden">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full w-8 h-8" title="Toggle theme">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="sr-only">Toggle theme</span>
              </Button>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
            </div>
            <SheetContent side="right" className="w-[280px] pt-10">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation Menu</SheetTitle>
                <SheetDescription>Access different sections of BulkReferences</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-1">
                <Link href="/#converter" onClick={() => setNavOpen(false)} className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  Converter
                </Link>
                <Link href="/history" onClick={() => setNavOpen(false)} className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50">
                  <History className="w-4 h-4 text-muted-foreground" />
                  History
                </Link>
                <Link href="/about" onClick={() => setNavOpen(false)} className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  About
                </Link>
                <Link href="/contact" onClick={() => setNavOpen(false)} className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  Contact
                </Link>

                <div className="my-2 border-t border-border"></div>

                {isInitialized ? (
                  isAdmin ? (
                    <>
                      <Link href="/admin/reports" onClick={() => setNavOpen(false)} className="flex items-center gap-3 text-sm font-semibold text-primary hover:text-primary/80 transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50">
                        <LineChart className="w-4 h-4" />
                        Admin Mode
                      </Link>
                      <button onClick={() => { handleLogout(); setNavOpen(false); }} className="flex items-center gap-3 text-sm font-medium text-destructive hover:text-destructive/80 transition-colors py-3 px-2 text-left cursor-pointer rounded-md hover:bg-muted/50 w-full">
                        <LogOut className="w-4 h-4" />
                        Logout
                      </button>
                    </>
                  ) : isConfigured ? (
                    <Link href="/login" onClick={() => setNavOpen(false)} className="flex items-center gap-3 text-sm font-medium hover:text-primary transition-colors py-3 px-2 cursor-pointer rounded-md hover:bg-muted/50">
                      <LogIn className="w-4 h-4 text-muted-foreground" />
                      Login
                    </Link>
                  ) : null
                ) : null}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
