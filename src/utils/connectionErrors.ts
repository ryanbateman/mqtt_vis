/**
 * Human-readable MQTT connection error diagnosis.
 * Maps raw mqtt.js/WebSocket error strings and codes to actionable user messages.
 * All functions are pure and side-effect-free.
 */

/**
 * Diagnose a connection failure and return a user-friendly message.
 *
 * @param brokerUrl    The WebSocket URL the client attempted to connect to.
 * @param rawMessage   The raw Error.message string from mqtt.js (may be undefined).
 * @param errorCode    The Node.js error code e.g. "ECONNREFUSED" (may be undefined).
 * @param pageProtocol The current page protocol, e.g. "https:" or "http:".
 */
export function diagnoseConnectionError(
  brokerUrl: string,
  rawMessage: string | undefined,
  errorCode: string | undefined,
  pageProtocol: string,
): string {
  // Mixed content: HTTPS page connecting to a plain ws:// broker.
  // Browsers block this silently — the user must use wss://.
  if (pageProtocol === "https:" && brokerUrl.startsWith("ws://")) {
    return (
      "Mixed content blocked — your page is served over HTTPS but the broker " +
      'URL uses ws://. Change the URL to wss:// and try again.'
    );
  }

  const msg = rawMessage?.toLowerCase() ?? "";
  const code = errorCode?.toUpperCase() ?? "";

  // Authentication / authorisation rejection.
  // Must come BEFORE the generic "connection refused" check because some auth
  // errors are reported as "Connection refused: Not authorized" or "Connection
  // refused: rc5".
  if (
    msg.includes("not authorized") ||
    msg.includes("bad user name or password") ||
    msg.includes(": rc5") ||
    (msg.includes("connack") && (msg.includes("rc5") || msg.includes("return code 5") || msg.includes("code 5")))
  ) {
    return "Authentication rejected — check your username and password.";
  }

  // Connection refused: broker actively rejected the connection.
  if (code === "ECONNREFUSED" || msg.includes("econnrefused") || msg.includes("connection refused")) {
    return (
      "Connection refused — the broker is unreachable on that port. " +
      "Check the host, port, and that the broker is running."
    );
  }

  // DNS resolution failure: hostname doesn't resolve.
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || msg.includes("getaddrinfo") || msg.includes("enotfound")) {
    return "Hostname not found — check the broker URL for typos.";
  }

  // Network timeout: host is reachable but not responding.
  if (code === "ETIMEDOUT" || code === "ECONNABORTED" || msg.includes("timeout") || msg.includes("etimedout")) {
    return (
      "Connection timed out — the broker is not responding. " +
      "Check the host and port, and that WebSocket connections are allowed."
    );
  }

  // TLS / certificate errors.
  if (
    code === "CERT_HAS_EXPIRED" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    msg.includes("ssl") ||
    msg.includes("tls") ||
    msg.includes("certificate") ||
    msg.includes("handshake")
  ) {
    return (
      "TLS handshake failed — the broker may not support wss:// on this port, " +
      "or the certificate is invalid."
    );
  }

  // Wrong endpoint: server responds but it's not an MQTT WebSocket endpoint.
  if (msg.includes("unexpected server response") || msg.includes("invalid status code") || msg.includes("websocket")) {
    return (
      "The server responded but rejected the WebSocket upgrade — " +
      "check the URL path (e.g. /mqtt) and port number."
    );
  }

  // Network unreachable / no route to host.
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH" || msg.includes("network unreachable")) {
    return "Network unreachable — check your internet connection.";
  }

  // Fallback: show the raw error message if we have one, otherwise generic.
  if (rawMessage) {
    return rawMessage;
  }
  return "Connection failed — check the broker URL and your network.";
}

/**
 * Format a connection log timestamp as HH:MM:SS.
 */
export function formatLogTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
