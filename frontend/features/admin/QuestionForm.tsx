"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/layout/ErrorState";
import { Select } from "@/components/ui/select";
import type { AdminQuestion, Difficulty, ProblemParameter, StarterCode, TestCase } from "@/types/api";
import { adminApi } from "@/lib/api/admin";

const languages = ["javascript", "java", "python"] as const;
const blankCase = (): TestCase => ({ input: "", output: "" });

export function QuestionForm({ question, onSaved }: { question?: AdminQuestion; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(question?.title ?? "");
  const [slug, setSlug] = useState(question?.slug ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? "Easy");
  const [description, setDescription] = useState(question?.description ?? "");
  const [constraints, setConstraints] = useState<string[]>(question?.constraints?.length ? question.constraints : [""]);
  const [samples, setSamples] = useState<TestCase[]>(question?.sampleTestCases?.length ? question.sampleTestCases : [blankCase()]);
  const [hidden, setHidden] = useState<TestCase[]>(question?.hiddenTestCases?.length ? question.hiddenTestCases : [blankCase()]);
  const [tags, setTags] = useState(question?.tags?.join(", ") ?? "");
  const [functionName, setFunctionName] = useState(question?.functionName ?? "");
  const [parameters, setParameters] = useState<ProblemParameter[]>(question?.parameters ?? []);
  const [returnType, setReturnType] = useState(question?.returnType ?? "void");
  const [starterCode, setStarterCode] = useState<StarterCode[]>(question?.starterCode ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCase = (list: TestCase[], setList: (value: TestCase[]) => void, index: number, key: keyof TestCase, value: string) => {
    setList(list.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const payload = {
      title, slug, difficulty, description,
      constraints: constraints.filter(Boolean),
      sampleTestCases: samples.filter((item) => item.input || item.output),
      hiddenTestCases: hidden.filter((item) => item.input || item.output),
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      functionName, parameters, returnType, starterCode,
    };
    try {
      const response = question ? await adminApi.updateQuestion(question._id, payload) : await adminApi.createQuestion(payload);
      onSaved(response.question._id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save question.");
    } finally {
      setPending(false);
    }
  };
  return <form onSubmit={submit} className="space-y-6">
    {error ? <ErrorState title="Unable to save question" description={error} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Title<input required value={title} onChange={(event) => { const value = event.target.value; setTitle(value); if (!question && !slug) setSlug(value.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-")); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
      <label className="text-sm">Slug<input required value={slug} onChange={(event) => setSlug(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
      <label className="text-sm">Difficulty<Select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option>Easy</option><option>Medium</option><option>Hard</option></Select></label>
      <label className="text-sm">Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="array, strings" className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
    </div>
    <label className="block text-sm">Description<textarea required value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
    <ListEditor label="Constraints" values={constraints} onChange={setConstraints} />
    <CaseEditor label="Sample test cases" values={samples} onChange={setSamples} update={updateCase} />
    <CaseEditor label="Hidden test cases" values={hidden} onChange={setHidden} update={updateCase} />
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm">Function name<input required value={functionName} onChange={(event) => setFunctionName(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
      <label className="text-sm">Return type<input required value={returnType} onChange={(event) => setReturnType(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
      <div className="text-sm">Parameters<div className="mt-1 space-y-2">{parameters.map((parameter, index) => <div className="flex gap-2" key={index}><input aria-label={`Parameter ${index + 1} name`} value={parameter.name} onChange={(event) => setParameters(parameters.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="name" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2" /><input aria-label={`Parameter ${index + 1} type`} value={parameter.type} onChange={(event) => setParameters(parameters.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item))} placeholder="type" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2" /><Button type="button" variant="ghost" onClick={() => setParameters(parameters.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}</div><Button type="button" variant="outline" className="mt-2" onClick={() => setParameters([...parameters, { name: "", type: "" }])}>Add parameter</Button></div>
    </div>
    <div className="space-y-2"><p className="text-sm font-medium">Starter code</p>{starterCode.map((item, index) => <div className="flex flex-col gap-2 sm:flex-row" key={index}><Select aria-label={`Starter language ${index + 1}`} value={item.language} onChange={(event) => setStarterCode(starterCode.map((code, codeIndex) => codeIndex === index ? { ...code, language: event.target.value } : code))}>{languages.map((language) => <option key={language}>{language}</option>)}</Select><textarea aria-label={`Starter code ${index + 1}`} value={item.code} onChange={(event) => setStarterCode(starterCode.map((code, codeIndex) => codeIndex === index ? { ...code, code: event.target.value } : code))} rows={3} className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" /><Button type="button" variant="ghost" onClick={() => setStarterCode(starterCode.filter((_, codeIndex) => codeIndex !== index))}>Remove</Button></div>)}<Button type="button" variant="outline" onClick={() => setStarterCode([...starterCode, { language: "javascript", code: "" }])}>Add language</Button></div>
    <Button disabled={pending} type="submit">{pending ? "Saving..." : question ? "Update question" : "Create question"}</Button>
  </form>;
}

function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (value: string[]) => void }) {
  return <div className="space-y-2"><p className="text-sm font-medium">{label}</p>{values.map((value, index) => <div className="flex gap-2" key={index}><input aria-label={`${label} ${index + 1}`} value={value} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2" /><Button type="button" variant="ghost" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}<Button type="button" variant="outline" onClick={() => onChange([...values, ""])}>Add item</Button></div>;
}

function CaseEditor({ label, values, onChange, update }: { label: string; values: TestCase[]; onChange: (value: TestCase[]) => void; update: (list: TestCase[], setList: (value: TestCase[]) => void, index: number, key: keyof TestCase, value: string) => void }) {
  return <div className="space-y-2"><p className="text-sm font-medium">{label}</p>{values.map((item, index) => <div className="grid gap-2 sm:grid-cols-2" key={index}><textarea aria-label={`${label} ${index + 1} input`} value={item.input} onChange={(event) => update(values, onChange, index, "input", event.target.value)} placeholder="Input" className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" /><textarea aria-label={`${label} ${index + 1} output`} value={item.output} onChange={(event) => update(values, onChange, index, "output", event.target.value)} placeholder="Output" className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" /><Button type="button" variant="ghost" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Remove case</Button></div>)}<Button type="button" variant="outline" onClick={() => onChange([...values, blankCase()])}>Add case</Button></div>;
}
