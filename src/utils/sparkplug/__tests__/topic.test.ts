import { describe, it, expect } from "vitest";
import {
  parseSparkplugTopic,
  isSparkplugTopic,
  sparkplugDeviceKey,
  isBirth,
  isDeath,
} from "../topic";

describe("isSparkplugTopic", () => {
  it("matches spBv1.0 and STATE prefixes", () => {
    expect(isSparkplugTopic("spBv1.0/g/NBIRTH/e")).toBe(true);
    expect(isSparkplugTopic("STATE/host1")).toBe(true);
  });

  it("rejects other topics", () => {
    expect(isSparkplugTopic("home/kitchen/temp")).toBe(false);
    expect(isSparkplugTopic("spBv2.0/g/NBIRTH/e")).toBe(false);
    expect(isSparkplugTopic("spBv1.0")).toBe(false); // no trailing slash
    expect(isSparkplugTopic("x/spBv1.0/g/NBIRTH/e")).toBe(false); // mid-topic
  });
});

describe("parseSparkplugTopic — node-level messages", () => {
  it.each(["NBIRTH", "NDEATH", "NDATA", "NCMD"] as const)("parses %s", (type) => {
    const info = parseSparkplugTopic(`spBv1.0/plant1/${type}/edge7`);
    expect(info).toEqual({
      groupId: "plant1",
      messageType: type,
      edgeNodeId: "edge7",
      deviceId: null,
    });
  });

  it("rejects node-level messages with a device segment", () => {
    expect(parseSparkplugTopic("spBv1.0/g/NBIRTH/edge/dev")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/g/NDATA/edge/dev")).toBeNull();
  });
});

describe("parseSparkplugTopic — device-level messages", () => {
  it.each(["DBIRTH", "DDEATH", "DDATA", "DCMD"] as const)("parses %s", (type) => {
    const info = parseSparkplugTopic(`spBv1.0/plant1/${type}/edge7/pump2`);
    expect(info).toEqual({
      groupId: "plant1",
      messageType: type,
      edgeNodeId: "edge7",
      deviceId: "pump2",
    });
  });

  it("rejects device-level messages without a device segment", () => {
    expect(parseSparkplugTopic("spBv1.0/g/DBIRTH/edge")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/g/DDATA/edge")).toBeNull();
  });
});

describe("parseSparkplugTopic — STATE", () => {
  it("parses Sparkplug 3.0 host state", () => {
    expect(parseSparkplugTopic("spBv1.0/STATE/scada1")).toEqual({
      groupId: "",
      messageType: "STATE",
      edgeNodeId: "scada1",
      deviceId: null,
    });
  });

  it("parses legacy 2.2 host state", () => {
    expect(parseSparkplugTopic("STATE/scada1")).toEqual({
      groupId: "",
      messageType: "STATE",
      edgeNodeId: "scada1",
      deviceId: null,
    });
  });

  it("rejects malformed STATE topics", () => {
    expect(parseSparkplugTopic("STATE")).toBeNull();
    expect(parseSparkplugTopic("STATE/a/b")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/STATE")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/STATE/a/b")).toBeNull();
  });
});

describe("parseSparkplugTopic — rejects", () => {
  it("rejects wrong namespace, bad message types, missing segments", () => {
    expect(parseSparkplugTopic("spBv2.0/g/NBIRTH/e")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/g/XBIRTH/e")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/g/NBIRTH")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/g")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0//NBIRTH/e")).toBeNull();
    expect(parseSparkplugTopic("spBv1.0/g/NBIRTH/e/d/x")).toBeNull();
    expect(parseSparkplugTopic("home/kitchen/temp")).toBeNull();
  });
});

describe("sparkplugDeviceKey", () => {
  it("builds group/edge for node-level and group/edge/device for device-level", () => {
    expect(sparkplugDeviceKey(parseSparkplugTopic("spBv1.0/g/NBIRTH/e")!)).toBe("g/e");
    expect(sparkplugDeviceKey(parseSparkplugTopic("spBv1.0/g/DDATA/e/d")!)).toBe("g/e/d");
  });

  it("returns null for STATE topics", () => {
    expect(sparkplugDeviceKey(parseSparkplugTopic("STATE/host")!)).toBeNull();
  });
});

describe("isBirth / isDeath", () => {
  it("classifies message types", () => {
    expect(isBirth("NBIRTH")).toBe(true);
    expect(isBirth("DBIRTH")).toBe(true);
    expect(isBirth("NDATA")).toBe(false);
    expect(isDeath("NDEATH")).toBe(true);
    expect(isDeath("DDEATH")).toBe(true);
    expect(isDeath("DCMD")).toBe(false);
  });
});
