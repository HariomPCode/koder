const express = require("express");
const { getLiveness, getReadiness } = require("../services/health.service");

const router = express.Router();

router.get("/live", (req, res) => {
  return res.status(200).json(getLiveness());
});

router.get("/ready", (req, res) => {
  const result = getReadiness();
  return res.status(result.ready ? 200 : 503).json({
    status: result.ready ? "ok" : "not_ready",
    dependencies: result.dependencies,
  });
});

module.exports = router;
