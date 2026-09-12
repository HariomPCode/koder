"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";

export function useRequireAuth() {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuth();

  useEffect(() => {
    if (auth.status !== "unauthenticated") return;
    const next = pathname && pathname !== "/signin" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/signin${next}`);
  }, [auth.status, pathname, router]);

  return auth;
}
