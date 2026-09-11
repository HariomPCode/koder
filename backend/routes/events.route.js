const express = require("express");
const eventBus = require("../events/eventBus");
const { ContestParticipant } = require("@koder/shared");
const { authMiddleware } = require("../middleware");

const router = express.Router();

router.get("/stream", authMiddleware, (req, res) => {
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const userId = String(req.userId);
  const writeEvent = async (payload, eventName, event) => {
    if (!payload || (payload.userId && String(payload.userId) !== userId)) return;
    if (payload.contestId && !payload.userId) {
      let isParticipant = false;
      try {
        isParticipant = Boolean(await ContestParticipant.exists({
          contestId: payload.contestId,
          userId,
        }));
      } catch (_) {
        return;
      }
      if (!isParticipant) return;
    }
    const safePayload = {
      event: eventName,
      ...(payload.submissionId ? { submissionId: String(payload.submissionId) } : {}),
      ...(payload.contestId ? { contestId: String(payload.contestId) } : {}),
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.verdict ? { verdict: payload.verdict } : {}),
      ...(payload.failureType ? { failureType: payload.failureType } : {}),
    };
    res.write(`id: ${event?.eventId || `${Date.now()}-${Math.random().toString(36).slice(2)}`}\nevent: ${eventName}\ndata: ${JSON.stringify(safePayload)}\n\n`);
  };

  const unsubscribe = eventBus.onAny(writeEvent);
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("aborted", cleanup);
  req.on("close", cleanup);
  res.on("error", cleanup);
});

module.exports = router;
