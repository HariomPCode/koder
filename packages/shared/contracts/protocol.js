/**
 * Base64 Line Streaming Protocol (BLSP)
 *
 * Guaranteed 1-line-per-message framing immune to newlines, quotes,
 * arbitrary unicode, binary data, or user output interference.
 *
 * Request format:  "<caseId> <base64(input)>\n"
 * Control format:  "EXIT\n"
 * Response format: "<caseId> <OK|ERROR|FATAL_ERROR> <base64(output|error)>\n"
 */

/**
 * Encodes a test case input into a single protocol request line.
 * @param {number|string} caseId
 * @param {string} input
 * @returns {string}
 */
function encodeRequest(caseId, input) {
  const b64 = Buffer.from(input || "", "utf8").toString("base64");
  return `${caseId} ${b64}\n`;
}

/**
 * Decodes a runner response line into a structured object.
 * @param {string} line
 * @returns {{ caseId: number, status: "OK" | "ERROR" | "FATAL_ERROR", payload: string } | null}
 */
function decodeResponse(line) {
  if (!line || typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return null;

  const caseId = parseInt(trimmed.substring(0, firstSpace), 10);
  if (isNaN(caseId)) return null;

  const secondSpace = trimmed.indexOf(" ", firstSpace + 1);
  let status = "OK";
  let b64Payload = "";

  if (secondSpace === -1) {
    status = trimmed.substring(firstSpace + 1);
  } else {
    status = trimmed.substring(firstSpace + 1, secondSpace);
    b64Payload = trimmed.substring(secondSpace + 1);
  }

  let payload = "";
  try {
    payload = Buffer.from(b64Payload, "base64").toString("utf8");
  } catch (_) {
    payload = b64Payload;
  }

  return {
    caseId,
    status: status === "OK" ? "OK" : (status === "FATAL_ERROR" ? "FATAL_ERROR" : "ERROR"),
    payload,
  };
}

module.exports = {
  encodeRequest,
  decodeResponse,
};
