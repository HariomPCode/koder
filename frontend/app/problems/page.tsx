"use client";

import { toast } from "@/components/ui/toast";
import Link from "next/link";
import { useEffect, useState } from "react";

interface Problem {
  _id: string;
  questionNum: number;
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
}

function Problems() {
  const [problems, setProblems] = useState<Problem[]>([]);

  const backendUri = process.env.NEXT_PUBLIC_BACKEND_URL;

  useEffect(() => {
    fetchQuestion();
  }, []);

  const fetchQuestion = async () => {
    try {
      const res = await fetch(
        `${backendUri}/api/v1/questions?page=1&limit=20`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        },
      );

      if (!res.ok) {
        throw new Error("Failed to fetch questions");
      }

      const data = await res.json();

      setProblems(data.questions);
      toast.add({
        type: "success",
        description: data.message,
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <div>
        {problems.map((problem) => (
          <Link href={`/problems/${problem.slug}`}>
            <div
              key={problem._id}
              className="flex justify-between items-center m-2 p-2 pl-4 pr-4 bg-gray-200 rounded-sm"
            >
              <div className="flex gap-2">
                <h2>{problem.questionNum}</h2>
                <p>{problem.title}</p>
              </div>
              <p>{problem.difficulty}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

export default Problems;
