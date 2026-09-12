"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorState } from "@/components/layout/ErrorState";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-client";
import { getCurrentUser } from "@/lib/api/user";
import type { User } from "@/types/api";

function ProfileLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-5 w-80 max-w-full" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </PageContainer>
  );
}

function displayValue(value: number | undefined) {
  return value === undefined ? "Not available" : value;
}

export function ProfileContent() {
  const [profile, setProfile] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setError(null);
    try {
      const response = await getCurrentUser();
      setProfile(response.user);
    } catch (caughtError) {
      console.error(caughtError);
      setError(
        caughtError instanceof ApiError
          ? caughtError.message
          : "Unable to load your profile. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    // The profile request synchronizes this client island with the authenticated API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile();
  }, [loadProfile]);

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Unable to load profile"
          description={error}
          action={{ label: "Try again", onClick: () => void loadProfile() }}
        />
      </PageContainer>
    );
  }

  if (!profile) return <ProfileLoading />;

  const fullName = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <PageContainer>
      <header>
        <p className="text-sm font-medium text-muted-foreground">Account</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {fullName}
          </h1>
          <Badge className="border-primary/30 bg-primary/10 text-primary">
            {profile.role}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Your profile information and coding progress context.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Account details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Name
              </p>
              <p className="mt-1 text-base font-medium text-foreground">{fullName}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Email
              </p>
              <p className="mt-1 break-all text-base font-medium text-foreground">
                {profile.email}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Role
              </p>
              <p className="mt-1 text-base font-medium capitalize text-foreground">
                {profile.role}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold tracking-tight text-foreground">
              {displayValue(profile.rating)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Current rating</p>
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-2xl font-semibold text-foreground">
                {displayValue(profile.highestRating)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Highest rating</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Contest participation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-semibold tracking-tight text-foreground">
            {displayValue(profile.contestsParticipated)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Contests participated
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
