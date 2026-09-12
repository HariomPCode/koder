import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Contest } from "@/types/api";

export function ContestCard({ contest }: { contest: Contest }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{contest.title}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {contest.description || "Join this contest and test your skills."}
            </p>
          </div>
          <Badge className="shrink-0">{contest.status}</Badge>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Problems</dt>
            <dd className="font-medium text-foreground">{contest.problems.length}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Starts</dt>
            <dd className="font-medium text-foreground">
              {new Date(contest.startTime).toLocaleString()}
            </dd>
          </div>
        </dl>
        <Link
          href={`/contests/${contest._id}`}
          className="mt-5 inline-flex text-sm font-semibold text-foreground underline underline-offset-4"
        >
          View contest
        </Link>
      </CardContent>
    </Card>
  );
}
