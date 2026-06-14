import { describe, it, expect, beforeEach } from "vitest";
import { recordOwnTracksMessage } from "../owntracks";
import { createEntityRegistry, DOMAIN_ENTITY_CAP, type EntityRegistry } from "../entityOps";

/** A minimal OwnTracks location payload. */
function location(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ _type: "location", lat: 51.5, lon: -0.1, tst: 1700000000, ...extra });
}

describe("recordOwnTracksMessage", () => {
  let registry: EntityRegistry;
  beforeEach(() => {
    registry = createEntityRegistry();
  });

  it("ignores non-owntracks topics", () => {
    expect(recordOwnTracksMessage(registry, "home/temp", "home/temp", "21")).toBeNull();
    expect(registry.entities.size).toBe(0);
  });

  it("ignores topics without both a user and a device", () => {
    expect(recordOwnTracksMessage(registry, "owntracks/alice", "owntracks/alice", "{}")).toBeNull();
    expect(registry.entities.size).toBe(0);
  });

  it("creates a user→device tree from a base location topic", () => {
    const topic = "owntracks/alice/phone";
    const hit = recordOwnTracksMessage(registry, topic, topic, location())!;

    expect(hit.entity.key).toBe("owntracks:dev:alice/phone");
    expect(hit.entity.role).toBe("tracker");
    expect(hit.entity.label).toBe("phone");
    expect(hit.entity.parentKey).toBe("owntracks:user:alice");
    expect(hit.entity.attributes.type).toBe("tracker");
    expect(hit.entity.anchorTopicId).toBe(topic);
    expect(hit.entity.online).toBe(true);
    expect(hit.changed).toBe(true);

    // The user parent is created implicitly so the panel can group devices.
    const user = registry.entities.get("owntracks:user:alice")!;
    expect(user.role).toBe("user");
    expect(user.parentKey).toBeNull();
  });

  it("flips online on the location/lwt _type", () => {
    const topic = "owntracks/alice/phone";
    recordOwnTracksMessage(registry, topic, topic, location());
    const dev = registry.entities.get("owntracks:dev:alice/phone")!;
    expect(dev.online).toBe(true);

    recordOwnTracksMessage(registry, topic, topic, JSON.stringify({ _type: "lwt", tst: 1700000001 }));
    expect(dev.online).toBe(false);

    recordOwnTracksMessage(registry, topic, topic, location());
    expect(dev.online).toBe(true);
  });

  it("prefers the card name for the device label and records tid", () => {
    const topic = "owntracks/alice/phone";
    recordOwnTracksMessage(registry, topic, topic, location({ tid: "al" }));
    const dev = registry.entities.get("owntracks:dev:alice/phone")!;
    expect(dev.label).toBe("phone");
    expect(dev.attributes.tid).toBe("al");

    const info = "owntracks/alice/phone/info";
    recordOwnTracksMessage(registry, info, info, JSON.stringify({ _type: "card", name: "Alice's iPhone" }));
    expect(dev.label).toBe("Alice's iPhone");
  });

  it("summarises the latest transition event", () => {
    const event = "owntracks/alice/phone/event";
    recordOwnTracksMessage(
      registry,
      event,
      event,
      JSON.stringify({ _type: "transition", event: "enter", desc: "Home" }),
    );
    const dev = registry.entities.get("owntracks:dev:alice/phone")!;
    expect(dev.attributes.lastEvent).toBe("enter Home");
  });

  it("groups device subtopics under the same device, anchoring on the base topic", () => {
    const base = "owntracks/alice/phone";
    const event = "owntracks/alice/phone/event";
    // Subtopic seen first — becomes the provisional anchor.
    recordOwnTracksMessage(registry, event, event, JSON.stringify({ _type: "transition", event: "leave" }));
    const dev = registry.entities.get("owntracks:dev:alice/phone")!;
    expect(dev.anchorTopicId).toBe(event);

    // Base location topic seen — anchor upgrades to it.
    recordOwnTracksMessage(registry, base, base, location());
    expect(dev.anchorTopicId).toBe(base);
    expect(dev.topicNodeIds.size).toBe(2);
  });

  it("binds structurally even when the payload is not JSON", () => {
    const topic = "owntracks/bob/watch";
    const hit = recordOwnTracksMessage(registry, topic, topic, "not-json")!;
    expect(hit.entity.key).toBe("owntracks:dev:bob/watch");
    expect(hit.entity.online).toBeNull(); // no _type → no lifecycle signal
  });

  it("respects the entity cap", () => {
    for (let i = 0; i < DOMAIN_ENTITY_CAP; i++) {
      registry.entities.set(`k${i}`, {
        key: `k${i}`, ecosystem: "owntracks", role: "tracker", label: `k${i}`,
        parentKey: null, online: null, attributes: {}, anchorTopicId: null,
        topicNodeIds: new Set(),
      });
    }
    const topic = "owntracks/over/flow";
    expect(recordOwnTracksMessage(registry, topic, topic, location())).toBeNull();
    expect(registry.entities.has("owntracks:user:over")).toBe(false);
  });
});
