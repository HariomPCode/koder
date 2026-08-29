const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const { Question, generateStarterCode } = require("@koder/shared");

const problemsData = [
  {
    questionNum: 1,
    title: "Two Sum",
    slug: "two-sum",
    difficulty: "Easy",
    description:
      "Given an array of integers nums and an integer target, return the indices of the two numbers such that they add up to target.\n\nYou may assume that each input has exactly one solution, and you may not use the same element twice.\n\nReturn the answer in any order.",
    functionName: "twoSum",
    parameters: [
      { name: "nums", type: "int[]" },
      { name: "target", type: "int" },
    ],
    returnType: "int[]",
    constraints: [
      "2 <= nums.length <= 10^4",
      "-10^9 <= nums[i] <= 10^9",
      "-10^9 <= target <= 10^9",
      "Exactly one valid answer exists.",
    ],
    sampleTestCases: [
      { input: "4\n2 7 11 15\n9", output: "0 1" },
      { input: "3\n3 2 4\n6", output: "1 2" },
    ],
    hiddenTestCases: [
      { input: "2\n3 3\n6", output: "0 1" },
      { input: "5\n1 5 8 10 15\n25", output: "3 4" },
      { input: "6\n-1 -2 -3 -4 -5 -6\n-11", output: "4 5" },
    ],
    tags: ["Array", "HashMap"],
  },
  {
    questionNum: 2,
    title: "Valid Palindrome",
    slug: "valid-palindrome",
    difficulty: "Easy",
    description:
      "Given a string s, return true if it is a palindrome, and false otherwise.\n\nA string is a palindrome when it reads the same backward as forward.",
    functionName: "isPalindrome",
    parameters: [{ name: "s", type: "string" }],
    returnType: "boolean",
    constraints: [
      "1 <= s.length <= 2 * 10^5",
      "s consists only of printable ASCII characters.",
    ],
    sampleTestCases: [
      { input: "racecar", output: "true" },
      { input: "hello", output: "false" },
    ],
    hiddenTestCases: [
      { input: "a", output: "true" },
      { input: "ab", output: "false" },
      { input: "level", output: "true" },
      { input: "12321", output: "true" },
      { input: "noon", output: "true" },
    ],
    tags: ["String", "Two Pointers"],
  },
  {
    questionNum: 3,
    title: "Find Maximum Element in Array",
    slug: "find-maximum-in-array",
    difficulty: "Easy",
    description:
      "Given an integer array nums, find and return the maximum element in the array.",
    functionName: "findMax",
    parameters: [{ name: "nums", type: "int[]" }],
    returnType: "int",
    constraints: ["1 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9"],
    sampleTestCases: [
      { input: "4\n1 5 3 2", output: "5" },
      { input: "5\n-10 -5 -20 -3 -100", output: "-3" },
    ],
    hiddenTestCases: [
      { input: "1\n42", output: "42" },
      { input: "6\n10 20 30 40 50 60", output: "60" },
      { input: "4\n0 0 0 0", output: "0" },
      { input: "5\n99 10 20 30 40", output: "99" },
    ],
    tags: ["Array"],
  },
  {
    questionNum: 4,
    title: "Running Sum of 1D Array",
    slug: "running-sum-of-1d-array",
    difficulty: "Easy",
    description:
      "Given an array nums. We define a running sum of an array as runningSum[i] = sum(nums[0]...nums[i]).\n\nReturn the running sum of nums.",
    functionName: "runningSum",
    parameters: [{ name: "nums", type: "int[]" }],
    returnType: "int[]",
    constraints: ["1 <= nums.length <= 1000", "-10^6 <= nums[i] <= 10^6"],
    sampleTestCases: [
      { input: "4\n1 2 3 4", output: "1 3 6 10" },
      { input: "5\n1 1 1 1 1", output: "1 2 3 4 5" },
    ],
    hiddenTestCases: [
      { input: "5\n3 1 2 10 1", output: "3 4 6 16 17" },
      { input: "1\n100", output: "100" },
      { input: "4\n-1 -2 -3 -4", output: "-1 -3 -6 -10" },
    ],
    tags: ["Array", "Prefix Sum"],
  },
  {
    questionNum: 5,
    title: "Binary Search",
    slug: "binary-search",
    difficulty: "Easy",
    description:
      "Given an array of integers nums which is sorted in ascending order, and an integer target, write a function to search target in nums. If target exists, then return its index. Otherwise, return -1.",
    functionName: "search",
    parameters: [
      { name: "nums", type: "int[]" },
      { name: "target", type: "int" },
    ],
    returnType: "int",
    constraints: [
      "1 <= nums.length <= 10^4",
      "-10^4 < nums[i], target < 10^4",
      "All the integers in nums are unique.",
      "nums is sorted in ascending order.",
    ],
    sampleTestCases: [
      { input: "6\n-1 0 3 5 9 12\n9", output: "4" },
      { input: "6\n-1 0 3 5 9 12\n2", output: "-1" },
    ],
    hiddenTestCases: [
      { input: "1\n5\n5", output: "0" },
      { input: "1\n5\n-5", output: "-1" },
      { input: "5\n1 3 5 7 9\n1", output: "0" },
      { input: "5\n1 3 5 7 9\n9", output: "4" },
      { input: "5\n1 3 5 7 9\n4", output: "-1" },
    ],
    tags: ["Array", "Binary Search"],
  },
  {
    questionNum: 6,
    title: "Valid Anagram",
    slug: "valid-anagram",
    difficulty: "Easy",
    description:
      "Given two strings s and t, return true if t is an anagram of s, and false otherwise.\n\nAn Anagram is a word or phrase formed by rearranging the letters of a different word or phrase, typically using all the original letters exactly once.",
    functionName: "isAnagram",
    parameters: [
      { name: "s", type: "string" },
      { name: "t", type: "string" },
    ],
    returnType: "boolean",
    constraints: [
      "1 <= s.length, t.length <= 5 * 10^4",
      "s and t consist of lowercase English letters.",
    ],
    sampleTestCases: [
      { input: "anagram\nnagaram", output: "true" },
      { input: "rat\ncar", output: "false" },
    ],
    hiddenTestCases: [
      { input: "a\na", output: "true" },
      { input: "ab\na", output: "false" },
      { input: "listen\nsilent", output: "true" },
      { input: "aabbcc\nabcabc", output: "true" },
    ],
    tags: ["Hash Table", "String", "Sorting"],
  },
  {
    questionNum: 7,
    title: "Reverse String",
    slug: "reverse-string",
    difficulty: "Easy",
    description: "Given a string s, return the reversed string.",
    functionName: "reverseString",
    parameters: [{ name: "s", type: "string" }],
    returnType: "string",
    constraints: [
      "1 <= s.length <= 10^5",
      "s consists of printable ASCII characters.",
    ],
    sampleTestCases: [
      { input: "hello", output: "olleh" },
      { input: "world", output: "dlrow" },
    ],
    hiddenTestCases: [
      { input: "a", output: "a" },
      { input: "racecar", output: "racecar" },
      { input: "LeetCode", output: "edoCteeL" },
    ],
    tags: ["String", "Two Pointers"],
  },
  {
    questionNum: 8,
    title: "Fibonacci Number",
    slug: "fibonacci-number",
    difficulty: "Easy",
    description:
      "The Fibonacci numbers, commonly denoted F(n) form a sequence, called the Fibonacci sequence, such that each number is the sum of the two preceding ones, starting from 0 and 1. That is, F(0) = 0, F(1) = 1, F(n) = F(n - 1) + F(n - 2), for n > 1. Given n, calculate F(n).",
    functionName: "fib",
    parameters: [{ name: "n", type: "int" }],
    returnType: "int",
    constraints: ["0 <= n <= 30"],
    sampleTestCases: [
      { input: "2", output: "1" },
      { input: "3", output: "2" },
      { input: "4", output: "3" },
    ],
    hiddenTestCases: [
      { input: "0", output: "0" },
      { input: "1", output: "1" },
      { input: "5", output: "5" },
      { input: "6", output: "8" },
      { input: "10", output: "55" },
    ],
    tags: ["Math", "Dynamic Programming", "Recursion"],
  },
];

async function seedDatabase() {
  console.log("Connecting to MongoDB:", process.env.MONGODB_URI);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected successfully!");

  for (const prob of problemsData) {
    const starterCode = generateStarterCode({
      functionName: prob.functionName,
      parameters: prob.parameters,
      returnType: prob.returnType,
    });

    const doc = {
      ...prob,
      starterCode,
    };

    const updated = await Question.findOneAndUpdate(
      { slug: prob.slug },
      { $set: doc },
      { upsert: true, new: true },
    );

    console.log(
      `  ✓ Seeded/Updated question #${updated.questionNum}: "${updated.title}" (slug: ${updated.slug})`,
    );
  }

  const count = await Question.countDocuments();
  console.log(`\nDatabase now contains ${count} questions!`);
  await mongoose.disconnect();
}

seedDatabase().catch((err) => {
  console.error("Failed to seed database:", err);
  process.exit(1);
});
