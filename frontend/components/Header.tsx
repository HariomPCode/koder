"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { href: "/problems", label: "Problems" },
  { href: "/contests", label: "Contests" },
];

export default function Header() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setMobileOpen(false);
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-xl font-bold tracking-tight text-foreground">
          Koder
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
          {loading ? (
            <span className="text-sm text-muted-foreground">Loading...</span>
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-3 rounded-lg px-2 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-9">
                  <AvatarFallback>{user.firstName.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground">{user.firstName}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem disabled>
                  <div className="flex flex-col">
                    <span className="font-medium">{user.firstName}</span>
                    {user.rating !== undefined ? (
                      <span className="text-xs text-muted-foreground">
                        Rating {user.rating}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/dashboard")}>Dashboard</DropdownMenuItem>
                {user.role === "admin" ? <DropdownMenuItem onClick={() => router.push("/admin")}>Admin</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleLogout}>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link href="/signin"><Button variant="outline">Login</Button></Link>
          )}
        </nav>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent>
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">Navigation</span>
            <Button type="button" variant="ghost" size="icon" aria-label="Close navigation menu" onClick={() => setMobileOpen(false)}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <nav className="mt-8 flex flex-col gap-2" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="rounded-md px-3 py-3 text-base text-foreground hover:bg-muted">
                {item.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="rounded-md px-3 py-3 text-base text-foreground hover:bg-muted">Dashboard</Link>
                {user.role === "admin" ? <Link href="/admin" onClick={() => setMobileOpen(false)} className="rounded-md px-3 py-3 text-base text-foreground hover:bg-muted">Admin</Link> : null}
                <Button type="button" variant="ghost" className="justify-start px-3" onClick={handleLogout}>Logout</Button>
              </>
            ) : (
              <Link href="/signin" onClick={() => setMobileOpen(false)} className="mt-2"><Button className="w-full">Login</Button></Link>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </header>
  );
}
