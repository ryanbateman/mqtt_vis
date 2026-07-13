import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";

// Capture the options passed to mqtt.connect and hand back a controllable fake
// client so we can drive the connection lifecycle (connect/close/reconnect)
// deterministically, without a real broker.
let lastOptions: Record<string, unknown> | null = null;
let fakeClient: FakeClient | null = null;

class FakeClient extends EventEmitter {
  connected = false;
  // Echo the requested QoS back as "granted" (a real broker may downgrade, but
  // for these tests honoring the request is the useful behaviour to assert on).
  subscribe = vi.fn((topic: string, opts?: { qos?: 0 | 1 | 2 }, cb?: (e: Error | null, g?: unknown) => void) => {
    cb?.(null, [{ topic, qos: opts?.qos ?? 0 }]);
  });
  end = vi.fn((_force?: boolean | (() => void), cb?: () => void) => {
    if (typeof _force === "function") _force();
    else cb?.();
    return this;
  });
}

vi.mock("mqtt", () => ({
  default: {
    connect: (_url: string, options: Record<string, unknown>) => {
      lastOptions = options;
      fakeClient = new FakeClient();
      return fakeClient;
    },
  },
}));

// Import after the mock is registered.
const { mqttService } = await import("../mqttService");

const CONNECT = { brokerUrl: "wss://example/ws", topicFilter: "#" };

function driveReconnectCycle() {
  // Simulate one drop-and-recover: initial connect, then a close (offline),
  // a reconnect attempt, and a successful reconnect.
  fakeClient!.emit("connect", undefined); // first connect
  fakeClient!.emit("close"); // socket dropped -> offline window starts
  fakeClient!.emit("reconnect"); // mqtt.js retrying
  fakeClient!.emit("connect", undefined); // recovered
}

describe("mqttService — keep-alive option", () => {
  beforeEach(() => {
    lastOptions = null;
    fakeClient = null;
    mqttService.disconnect();
  });

  it("defaults keep-alive to 30s when unspecified", () => {
    mqttService.connect({ ...CONNECT });
    expect(lastOptions?.keepalive).toBe(30);
  });

  it("passes through an explicit keep-alive", () => {
    mqttService.connect({ ...CONNECT, keepalive: 45 });
    expect(lastOptions?.keepalive).toBe(45);
  });

  it("clamps a too-low keep-alive to the 5s floor (0 would disable pings)", () => {
    mqttService.connect({ ...CONNECT, keepalive: 0 });
    expect(lastOptions?.keepalive).toBe(5);
  });
});

describe("mqttService — reconnect visibility", () => {
  beforeEach(() => {
    fakeClient = null;
    mqttService.disconnect();
  });

  it("starts a fresh connection with no reconnect gaps", () => {
    mqttService.connect({ ...CONNECT });
    fakeClient!.emit("connect", undefined);
    expect(mqttService.reconnectGaps).toBe(0);
    expect(mqttService.connectionLog.some((e) => e.level === "warn")).toBe(false);
  });

  it("records a gap and a warn log entry when a reconnect completes", () => {
    mqttService.connect({ ...CONNECT });
    driveReconnectCycle();

    expect(mqttService.reconnectGaps).toBe(1);
    expect(mqttService.lastGapSeconds).toBeGreaterThanOrEqual(0);
    const warn = mqttService.connectionLog.find((e) => e.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/Reconnected after \d+s offline/);
  });

  it("counts each reconnect and resets on a fresh connect()", () => {
    mqttService.connect({ ...CONNECT });
    driveReconnectCycle();
    // A second drop/recover on the same session.
    fakeClient!.emit("close");
    fakeClient!.emit("reconnect");
    fakeClient!.emit("connect", undefined);
    expect(mqttService.reconnectGaps).toBe(2);

    // Reconnecting fresh clears the counters.
    mqttService.connect({ ...CONNECT });
    expect(mqttService.reconnectGaps).toBe(0);
    expect(mqttService.lastGapSeconds).toBe(0);
  });
});

describe("mqttService — subscribe QoS", () => {
  beforeEach(() => {
    fakeClient = null;
    mqttService.disconnect();
  });

  it("defaults the subscribe to QoS 1 (at-least-once)", () => {
    mqttService.connect({ ...CONNECT });
    fakeClient!.emit("connect", undefined);
    expect(fakeClient!.subscribe).toHaveBeenCalledWith(
      "#", { qos: 1 }, expect.any(Function),
    );
  });

  it("passes an explicit subscribe QoS through", () => {
    mqttService.connect({ ...CONNECT, qos: 0 });
    fakeClient!.emit("connect", undefined);
    expect(fakeClient!.subscribe).toHaveBeenCalledWith(
      "#", { qos: 0 }, expect.any(Function),
    );
  });

  it("logs the QoS the broker granted", () => {
    mqttService.connect({ ...CONNECT, qos: 1 });
    fakeClient!.emit("connect", undefined);
    expect(mqttService.connectionLog.some((e) => /at QoS 1/.test(e.message))).toBe(true);
  });
});
