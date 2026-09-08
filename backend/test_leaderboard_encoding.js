const assert = require("assert");
const {
  MAX_LAST_ACCEPTED_CONTEST_MS,
  MAX_SOLVED_COUNT,
  MAX_TOTAL_PENALTY,
  UNSOLVED_LAST_ACCEPTED_CONTEST_MS,
  LEADERBOARD_HEALTH,
  LEADERBOARD_META_STATE,
  LEADERBOARD_METADATA_FIELDS,
  buildLeaderboardActiveVersionKey,
  buildLeaderboardKey,
  buildLeaderboardMembersKey,
  buildLeaderboardMetaKey,
  decodeMember,
  decodeParticipant,
  encodeMember,
  encodeParticipant,
  encodeSolvedCount,
} = require("@koder/shared");

const USERS = {
  first: "000000000000000000000001",
  second: "000000000000000000000002",
  third: "000000000000000000000003",
};
const CONTEST_ID = "64e2d5ec5956e8d99d0f1234";

async function runTests() {
  const passed = [];
  const failed = [];

  async function testCase(name, fn) {
    try {
      await fn();
      passed.push(name);
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed.push({ name, error });
      console.log(`  ✗ ${name}`);
      console.log(`    ${error.message}`);
    }
  }

  await testCase("Versioned leaderboard keys are contest and generation scoped", () => {
    assert.strictEqual(
      buildLeaderboardKey(CONTEST_ID, "rebuild-1"),
      "koder:v1:contest:64e2d5ec5956e8d99d0f1234:leaderboard:rebuild-1",
    );
    assert.strictEqual(
      buildLeaderboardMembersKey(CONTEST_ID, "rebuild-1"),
      "koder:v1:contest:64e2d5ec5956e8d99d0f1234:leaderboard:rebuild-1:members",
    );
    assert.strictEqual(
      buildLeaderboardMetaKey(CONTEST_ID, "rebuild-1"),
      "koder:v1:contest:64e2d5ec5956e8d99d0f1234:leaderboard:rebuild-1:meta",
    );
    assert.strictEqual(
      buildLeaderboardActiveVersionKey(CONTEST_ID),
      "koder:v1:contest:64e2d5ec5956e8d99d0f1234:leaderboard:activeVersion",
    );
    assert.throws(() => buildLeaderboardKey("contest-1", "rebuild-1"), TypeError);
    assert.throws(() => buildLeaderboardKey(CONTEST_ID, "generation:1"), TypeError);
  });

  await testCase("Participant encoding round-trips solved, penalty, time, and ObjectId", () => {
    const encoded = encodeParticipant({
      solvedCount: 7,
      totalPenalty: 1234,
      lastAcceptedContestMs: 987654,
      userId: USERS.first.toUpperCase(),
    });

    assert.deepStrictEqual(decodeParticipant(encoded), {
      solvedCount: 7,
      totalPenalty: 1234,
      lastAcceptedContestMs: 987654,
      userId: USERS.first,
    });
    assert.strictEqual(encoded.score, -7);
    assert.strictEqual(encoded.member, `0000001234|0000000000987654|${USERS.first}`);
  });

  await testCase("Unsolved participants use the locked infinity sentinel", () => {
    const member = encodeMember({
      totalPenalty: 0,
      lastAcceptedContestMs: null,
      userId: USERS.first,
    });

    assert.strictEqual(member, `0000000000|${UNSOLVED_LAST_ACCEPTED_CONTEST_MS}|${USERS.first}`);
    assert.deepStrictEqual(decodeMember(member), {
      totalPenalty: 0,
      lastAcceptedContestMs: null,
      userId: USERS.first,
    });
  });

  await testCase("Lexicographic member order exactly preserves Phase 6 tie-breaks", () => {
    const participants = [
      { solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20, userId: USERS.second },
      { solvedCount: 3, totalPenalty: 999, lastAcceptedContestMs: 99, userId: USERS.third },
      { solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20, userId: USERS.first },
      { solvedCount: 2, totalPenalty: 40, lastAcceptedContestMs: 99, userId: USERS.third },
      { solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: null, userId: USERS.third },
    ];

    const ordered = participants
      .map((participant) => encodeParticipant(participant))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member))
      .map(decodeParticipant);

    assert.deepStrictEqual(
      ordered.map(({ solvedCount, totalPenalty, lastAcceptedContestMs, userId }) => ({
        solvedCount,
        totalPenalty,
        lastAcceptedContestMs,
        userId,
      })),
      [
        { solvedCount: 3, totalPenalty: 999, lastAcceptedContestMs: 99, userId: USERS.third },
        { solvedCount: 2, totalPenalty: 40, lastAcceptedContestMs: 99, userId: USERS.third },
        { solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20, userId: USERS.first },
        { solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: 20, userId: USERS.second },
        { solvedCount: 2, totalPenalty: 50, lastAcceptedContestMs: null, userId: USERS.third },
      ],
    );
  });

  await testCase("Ordinal ranks remain gap-free after deterministic ordering", () => {
    const ordered = [
      { score: -3, member: encodeMember({ totalPenalty: 1, lastAcceptedContestMs: 1, userId: USERS.first }) },
      { score: -2, member: encodeMember({ totalPenalty: 1, lastAcceptedContestMs: 1, userId: USERS.second }) },
      { score: -2, member: encodeMember({ totalPenalty: 1, lastAcceptedContestMs: 1, userId: USERS.third }) },
    ].sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));

    assert.deepStrictEqual(ordered.map((_, index) => index + 1), [1, 2, 3]);
  });

  await testCase("Bounds, malformed tokens, and non-ObjectId identifiers fail explicitly", () => {
    assert.strictEqual(encodeSolvedCount(0), 0);
    assert.strictEqual(encodeSolvedCount(MAX_SOLVED_COUNT), -MAX_SOLVED_COUNT);
    assert.throws(() => encodeSolvedCount(MAX_SOLVED_COUNT + 1), RangeError);
    assert.throws(
      () => encodeMember({ totalPenalty: MAX_TOTAL_PENALTY + 1, lastAcceptedContestMs: 0, userId: USERS.first }),
      RangeError,
    );
    assert.throws(
      () => encodeMember({ totalPenalty: 0, lastAcceptedContestMs: MAX_LAST_ACCEPTED_CONTEST_MS + 1, userId: USERS.first }),
      RangeError,
    );
    assert.throws(() => encodeMember({ totalPenalty: 0, lastAcceptedContestMs: 0, userId: "user-1" }), TypeError);
    assert.throws(() => decodeMember(`0000000000|${UNSOLVED_LAST_ACCEPTED_CONTEST_MS}|${USERS.first}|extra`), TypeError);
    assert.throws(() => decodeMember(`0000000000|9007199254740992|${USERS.first}`), RangeError);
    assert.throws(() => decodeParticipant({ score: 1, member: encodeMember({ totalPenalty: 0, lastAcceptedContestMs: 0, userId: USERS.first }) }), RangeError);
  });

  await testCase("Projection metadata contract exposes operational states only", () => {
    assert.deepStrictEqual(LEADERBOARD_META_STATE, { READY: "ready", REBUILDING: "rebuilding" });
    assert.deepStrictEqual(LEADERBOARD_HEALTH, { HEALTHY: "healthy", ERROR: "error" });
    assert.deepStrictEqual(LEADERBOARD_METADATA_FIELDS, {
      STATE: "state",
      GENERATION: "generation",
      LAST_SUCCESSFUL_REFRESH_AT: "lastSuccessfulRefreshAt",
      LAST_REBUILD_ID: "lastRebuildId",
      HEALTH: "health",
      ERROR: "error",
    });
  });

  console.log(`\nLeaderboard encoding checks: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
