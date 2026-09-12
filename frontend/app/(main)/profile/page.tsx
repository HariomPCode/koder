"use client";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { ProfileContent } from "@/features/profile/ProfileContent";

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}
