"use client";
import Editor from "@monaco-editor/react";
import { toast } from "@/components/ui/toast";
import { Button } from "@base-ui/react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface Testcase {
  input: string;
  output: string;
}

interface StarterCode {
  language: string;
  code: string;
}

interface Problem {
  _id: string;
  questionNum: number;
  title: string;
  slug: string;
  difficulty: string;
  description: string;
  constraints: string[];
  sampleTestCases: Testcase[];
  tags: string[];
  starterCode: StarterCode[];
}

interface Submission {
  status: string;
  verdict: string;
  passedTestCases: number;
  totalTestCases: number;
  maxRuntime: number;
  memory: number;
  failedTestcase: object;
}

export default function SolveProblem() {
  const { slug } = useParams();

  const backendUri = process.env.NEXT_PUBLIC_BACKEND_URL;

  const [problem, setProblem] = useState<Problem | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [code, setCode] = useState(`function solve() {

}`);
  const [language, setLanguage] = useState("");

  useEffect(() => {
    if (slug) {
      fetchQuestion();
    }
  }, [slug]);

  const fetchQuestion = async () => {
    try {
      const res = await fetch(`${backendUri}/api/v1/questions/${slug}`);

      if (!res.ok) {
        throw new Error("Failed to fetch question");
      }

      const data = await res.json();

      console.log(data.question);

      setProblem(data.question);

      const defaultLanguage = "javascript";

      const starter = data.question.starterCode.find(
        (item: StarterCode) => item.language === defaultLanguage,
      );

      setLanguage(defaultLanguage);
      setCode(starter?.code ?? "");
    } catch (err) {
      console.error(err);

      toast.add({
        type: "failure",
        description: "Failed to fetch question",
      });
    }
  };

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const newLanguage = event.target.value;

    setLanguage(newLanguage);

    const starter = problem?.starterCode.find(
      (item) => item.language === newLanguage,
    );

    setCode(starter?.code ?? "");

    // Clear previous result
    setSubmission(null);
  };

  const submitProblem = async () => {
    if (!problem) return;

    setIsSubmitting(true);

    try {
      console.log(language, code);
      const res = await fetch(
        `${backendUri}/api/v1/submissions/${problem._id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            language,
            code,
          }),
        },
      );

      if (!res.ok) {
        throw new Error("Submission failed");
      }

      const data = await res.json();

      toast.add({
        type: "success",
        description: "Submission queued",
      });

      pollSubmission(data.submissionId);
    } catch (err) {
      console.error(err);

      toast.add({
        type: "failure",
        description: "Failed to submit solution",
      });

      setIsSubmitting(false);
    }
  };

  const pollSubmission = (submissionId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${backendUri}/api/v1/submissions/${submissionId}`,
          {
            credentials: "include",
          },
        );

        if (!res.ok) {
          throw new Error("Failed to fetch submission");
        }

        const data = await res.json();

        setSubmission(data.submission);

        if (
          data.submission.status === "completed" ||
          data.submission.status === "failed"
        ) {
          clearInterval(interval);
          setIsSubmitting(false);

          toast.add({
            type: "success",
            description: data.submission.verdict,
          });
        }
      } catch (err) {
        clearInterval(interval);
        setIsSubmitting(false);

        console.error(err);

        toast.add({
          type: "failure",
          description: "Failed to fetch submission",
        });
      }
    }, 1000);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="h-14 border-b bg-white flex items-center justify-between px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            {problem?.questionNum}. {problem?.title}
          </h1>

          <span
            className={`text-xs px-2 py-1 rounded-full ${
              problem?.difficulty === "Easy"
                ? "bg-green-100 text-green-700"
                : problem?.difficulty === "Medium"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-red-100 text-red-700"
            }`}
          >
            {problem?.difficulty}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={handleLanguageChange}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="javascript">JavaScript</option>
            <option value="java">Java</option>
            <option value="python">Python</option>
          </select>

          <Button
            onClick={submitProblem}
            disabled={isSubmitting}
            className="bg-green-600 text-white px-5 py-2 rounded-md hover:bg-green-700"
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-1/2 overflow-y-auto border-r bg-white p-6">
          <p className="leading-7">{problem?.description}</p>

          <div className="mt-8 space-y-6">
            {problem?.sampleTestCases.map((testcase, index) => (
              <div key={index} className="rounded-lg border bg-gray-50 p-4">
                <h3 className="font-semibold mb-3">Example {index + 1}</h3>

                <div className="font-mono text-sm">
                  <p>
                    <span className="font-semibold">Input:</span>{" "}
                    {testcase.input}
                  </p>

                  <p className="mt-2">
                    <span className="font-semibold">Output:</span>{" "}
                    {testcase.output}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <h3 className="font-semibold mb-2">Constraints</h3>

            <pre className="bg-gray-100 rounded-lg p-4 whitespace-pre-wrap">
              {problem?.constraints.map((cons, index) => {
                return <p key={index}>{cons}</p>;
              })}
            </pre>
          </div>

          <div className="mt-8">
            <h3 className="font-semibold mb-3">Topics</h3>

            <div className="flex flex-wrap gap-2">
              {problem?.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-blue-100 text-blue-700 px-3 py-1 text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-1/2 flex flex-col bg-gray-900">
          {/* Monaco */}
          <div className="flex-1">
            <Editor
              height="100%"
              language={language}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value ?? "")}
              options={{
                fontSize: 15,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
              }}
            />
          </div>

          {/* Output */}
          <div className="h-60 border-t border-gray-700 bg-[#1e1e1e] text-white overflow-auto">
            <div className="p-5">
              <h2 className="font-semibold text-lg mb-4">Submission Result</h2>

              {!submission ? (
                <p className="text-gray-400">
                  Submit your code to see results.
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  <p>
                    <strong>Status:</strong> {submission.status}
                  </p>

                  <p>
                    <strong>Verdict:</strong> {submission.verdict}
                  </p>

                  <p>
                    <strong>Passed:</strong> {submission.passedTestCases}/
                    {submission.totalTestCases}
                  </p>

                  <p>
                    <strong>Runtime:</strong> {submission.maxRuntime} ms
                  </p>

                  <p>
                    <strong>Memory:</strong> {submission.memory} MB
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
