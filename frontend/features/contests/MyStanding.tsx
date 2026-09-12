import { Card, CardContent } from "@/components/ui/card";
import type { Standing } from "@/types/api";

export function MyStanding({ standing }: { standing: Standing | null }) {
  if (!standing) return null;
  return (
    <Card className="border-primary/30">
      <CardContent className="p-4">
        <p className="text-sm font-semibold text-foreground">My standing</p>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div><p className="text-2xl font-semibold text-foreground">{standing.rank}</p><p className="text-xs text-muted-foreground">Rank</p></div>
          <div><p className="text-2xl font-semibold text-foreground">{standing.score}</p><p className="text-xs text-muted-foreground">Score</p></div>
          <div><p className="text-2xl font-semibold text-foreground">{standing.penalty}</p><p className="text-xs text-muted-foreground">Penalty</p></div>
        </div>
      </CardContent>
    </Card>
  );
}
