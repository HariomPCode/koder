"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";

import { Button } from "@/components/ui/button";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Header() {
  const router = useRouter();

  const { user, loading, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-neutral-800 bg-black px-4 flex items-center justify-between sm:px-6 lg:px-8">
      <Link href="/" className="text-xl font-bold tracking-tight text-white">
        Koder
      </Link>

      <div className="flex items-center gap-5 sm:gap-8">
        <Link
          href="/problems"
          className="text-white hover:text-neutral-300 transition-colors"
        >
          Problems
        </Link>

        {loading ? (
          <div className="text-sm text-neutral-400">Loading...</div>
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-neutral-800 transition-colors outline-none">
              <Avatar className="h-9 w-9">
                <AvatarFallback>
                  {user.firstName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <span className="text-white font-medium">{user.firstName}</span>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem disabled>
                <div className="flex flex-col">
                  <span className="font-medium">{user.firstName}</span>

                  <span className="text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={() => router.push("/dashboard")}>
                Dashboard
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link href="/signin">
            <Button variant="outline">Login</Button>
          </Link>
        )}
      </div>
    </header>
  );
}
