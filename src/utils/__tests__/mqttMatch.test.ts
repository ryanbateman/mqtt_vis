import { describe, it, expect } from "vitest";
import { mqttTopicMatches } from "../mqttMatch";

describe("mqttTopicMatches", () => {
  it("matches exact topics", () => {
    expect(mqttTopicMatches("a/b/c", "a/b/c")).toBe(true);
    expect(mqttTopicMatches("a/b/c", "a/b/d")).toBe(false);
    expect(mqttTopicMatches("a/b", "a/b/c")).toBe(false);
    expect(mqttTopicMatches("a/b/c", "a/b")).toBe(false);
  });

  it("handles the # wildcard including the parent level", () => {
    expect(mqttTopicMatches("#", "anything/at/all")).toBe(true);
    expect(mqttTopicMatches("a/#", "a/b/c")).toBe(true);
    expect(mqttTopicMatches("a/#", "a")).toBe(true);
    expect(mqttTopicMatches("a/#", "b/c")).toBe(false);
    expect(mqttTopicMatches("homeassistant/#", "zigbee2mqtt/lamp")).toBe(false);
  });

  it("handles the + wildcard as exactly one level", () => {
    expect(mqttTopicMatches("a/+/c", "a/b/c")).toBe(true);
    expect(mqttTopicMatches("a/+/c", "a/b/d")).toBe(false);
    expect(mqttTopicMatches("a/+", "a/b")).toBe(true);
    expect(mqttTopicMatches("a/+", "a")).toBe(false);
    expect(mqttTopicMatches("a/+", "a/b/c")).toBe(false);
    expect(mqttTopicMatches("+/+/#", "x/y/z/w")).toBe(true);
  });

  it("covers the follow-on use case: preset filter vs declared topics", () => {
    expect(mqttTopicMatches("homeassistant/#", "homeassistant/sensor/t/state")).toBe(true);
    expect(mqttTopicMatches("homeassistant/#", "zigbee2mqtt/kitchen_plug")).toBe(false);
    expect(mqttTopicMatches("#", "zigbee2mqtt/kitchen_plug")).toBe(true);
  });
});
