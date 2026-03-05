import { describe, it, expect } from "vitest";
import { diagnoseConnectionError, formatLogTimestamp } from "../connectionErrors";

// Helper: call diagnoseConnectionError with common defaults
function diagnose(
  opts: {
    brokerUrl?: string;
    rawMessage?: string;
    errorCode?: string;
    pageProtocol?: string;
  } = {}
): string {
  return diagnoseConnectionError(
    opts.brokerUrl ?? "wss://broker.example.com:8884/mqtt",
    opts.rawMessage,
    opts.errorCode,
    opts.pageProtocol ?? "https:",
  );
}

describe("diagnoseConnectionError — mixed content", () => {
  it("detects ws:// broker on an https: page", () => {
    const result = diagnose({ brokerUrl: "ws://broker.example.com:1883", pageProtocol: "https:" });
    expect(result).toMatch(/mixed content/i);
    expect(result).toMatch(/wss:\/\//i);
  });

  it("does NOT flag ws:// on an http: page", () => {
    const result = diagnose({ brokerUrl: "ws://broker.example.com:1883", pageProtocol: "http:" });
    expect(result).not.toMatch(/mixed content/i);
  });

  it("does NOT flag wss:// on an https: page", () => {
    const result = diagnose({ brokerUrl: "wss://broker.example.com:8884/mqtt", pageProtocol: "https:" });
    expect(result).not.toMatch(/mixed content/i);
  });

  it("mixed content takes priority over other error info", () => {
    const result = diagnose({
      brokerUrl: "ws://broker.example.com:1883",
      pageProtocol: "https:",
      rawMessage: "ECONNREFUSED",
      errorCode: "ECONNREFUSED",
    });
    expect(result).toMatch(/mixed content/i);
  });
});

describe("diagnoseConnectionError — authentication", () => {
  it("detects 'not authorized' in message", () => {
    expect(diagnose({ rawMessage: "Connection refused: Not authorized" })).toMatch(/authentication rejected/i);
  });

  it("detects 'bad user name or password'", () => {
    expect(diagnose({ rawMessage: "Bad user name or password" })).toMatch(/authentication rejected/i);
  });

  it("detects CONNACK return code 5 pattern", () => {
    expect(diagnose({ rawMessage: "Connection refused: rc5" })).toMatch(/authentication rejected/i);
    expect(diagnose({ rawMessage: "CONNACK return code 5" })).toMatch(/authentication rejected/i);
  });
});

describe("diagnoseConnectionError — connection refused", () => {
  it("detects ECONNREFUSED error code", () => {
    expect(diagnose({ errorCode: "ECONNREFUSED" })).toMatch(/connection refused/i);
  });

  it("detects 'connection refused' in message", () => {
    expect(diagnose({ rawMessage: "connect ECONNREFUSED 127.0.0.1:1883" })).toMatch(/connection refused/i);
  });
});

describe("diagnoseConnectionError — DNS failure", () => {
  it("detects ENOTFOUND", () => {
    expect(diagnose({ errorCode: "ENOTFOUND" })).toMatch(/hostname not found/i);
  });

  it("detects EAI_AGAIN (transient DNS)", () => {
    expect(diagnose({ errorCode: "EAI_AGAIN" })).toMatch(/hostname not found/i);
  });

  it("detects getaddrinfo in message", () => {
    expect(diagnose({ rawMessage: "getaddrinfo ENOTFOUND broker.example.com" })).toMatch(/hostname not found/i);
  });
});

describe("diagnoseConnectionError — timeout", () => {
  it("detects ETIMEDOUT code", () => {
    expect(diagnose({ errorCode: "ETIMEDOUT" })).toMatch(/timed out/i);
  });

  it("detects 'timeout' in message", () => {
    expect(diagnose({ rawMessage: "Connection timeout" })).toMatch(/timed out/i);
  });
});

describe("diagnoseConnectionError — TLS", () => {
  it("detects CERT_HAS_EXPIRED", () => {
    expect(diagnose({ errorCode: "CERT_HAS_EXPIRED" })).toMatch(/tls/i);
  });

  it("detects SELF_SIGNED_CERT_IN_CHAIN", () => {
    expect(diagnose({ errorCode: "SELF_SIGNED_CERT_IN_CHAIN" })).toMatch(/tls/i);
  });

  it("detects 'ssl' in message", () => {
    expect(diagnose({ rawMessage: "SSL handshake failed" })).toMatch(/tls/i);
  });

  it("detects 'certificate' in message", () => {
    expect(diagnose({ rawMessage: "certificate has expired" })).toMatch(/tls/i);
  });
});

describe("diagnoseConnectionError — wrong endpoint", () => {
  it("detects unexpected server response", () => {
    expect(diagnose({ rawMessage: "Unexpected server response: 404" })).toMatch(/server responded/i);
  });

  it("detects invalid status code", () => {
    expect(diagnose({ rawMessage: "Invalid status code: 403" })).toMatch(/server responded/i);
  });
});

describe("diagnoseConnectionError — network unreachable", () => {
  it("detects ENETUNREACH", () => {
    expect(diagnose({ errorCode: "ENETUNREACH" })).toMatch(/network unreachable/i);
  });

  it("detects EHOSTUNREACH", () => {
    expect(diagnose({ errorCode: "EHOSTUNREACH" })).toMatch(/network unreachable/i);
  });
});

describe("diagnoseConnectionError — fallback", () => {
  it("returns the raw message when no pattern matches", () => {
    const raw = "Some unknown error XYZ-999";
    expect(diagnose({ rawMessage: raw })).toBe(raw);
  });

  it("returns generic message when rawMessage is undefined", () => {
    expect(diagnose({ rawMessage: undefined })).toMatch(/connection failed/i);
  });

  it("returns generic message when rawMessage is empty string", () => {
    expect(diagnose({ rawMessage: "" })).toMatch(/connection failed/i);
  });
});

describe("formatLogTimestamp", () => {
  it("formats a timestamp as HH:MM:SS", () => {
    // Create a fixed date: 13:05:07
    const d = new Date();
    d.setHours(13, 5, 7, 0);
    const result = formatLogTimestamp(d.getTime());
    expect(result).toBe("13:05:07");
  });

  it("zero-pads single-digit hours, minutes, seconds", () => {
    const d = new Date();
    d.setHours(1, 2, 3, 0);
    expect(formatLogTimestamp(d.getTime())).toBe("01:02:03");
  });
});
