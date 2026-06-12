import { describe, it, expect, beforeEach } from "vitest";
import {
  createEntityRegistry,
  applyEntityDeclarations,
  applyConfigTombstone,
  recordEntityTopicHit,
  removeEntityNodeRef,
  isEcosystemDefiningTopic,
  DOMAIN_ENTITY_CAP,
  type EntityRegistry,
} from "../entityOps";
import type { EntityDeclaration } from "../../../types/entities";

function makeDecl(overrides: Partial<EntityDeclaration>): EntityDeclaration {
  return {
    key: "homeassistant:ent:e1",
    ecosystem: "homeassistant",
    role: "sensor",
    label: "E1",
    parentKey: null,
    attributes: {},
    memberTopics: ["home/e1/state"],
    availability: [],
    sourceTopic: "homeassistant/sensor/e1/config",
    ...overrides,
  };
}

describe("isEcosystemDefiningTopic", () => {
  it("matches HA discovery topics only", () => {
    expect(isEcosystemDefiningTopic("homeassistant/sensor/x/config")).toBe(true);
    expect(isEcosystemDefiningTopic("zigbee2mqtt/lamp")).toBe(false);
  });
});

describe("entity registry", () => {
  let registry: EntityRegistry;
  beforeEach(() => {
    registry = createEntityRegistry();
  });

  it("creates entities and registers topic claims", () => {
    const changed = applyEntityDeclarations(registry, [
      makeDecl({
        memberTopics: ["home/e1/state", "home/e1/set"],
        availability: [
          { topic: "home/e1/lwt", payloadAvailable: "online", payloadNotAvailable: "offline" },
        ],
      }),
    ]);

    expect(changed).toBe(true);
    const entity = registry.entities.get("homeassistant:ent:e1")!;
    expect(entity.label).toBe("E1");
    expect(entity.online).toBeNull();

    expect(registry.topicIndex.get("home/e1/state")![0].kind).toBe("primary");
    expect(registry.topicIndex.get("home/e1/set")![0].kind).toBe("member");
    expect(registry.topicIndex.get("home/e1/lwt")![0].kind).toBe("availability");
  });

  it("re-declaration replaces topic claims but preserves live state", () => {
    applyEntityDeclarations(registry, [makeDecl({})]);
    recordEntityTopicHit(registry, "home/e1/state", "home/e1/state", "21.5");
    const entity = registry.entities.get("homeassistant:ent:e1")!;
    expect(entity.anchorTopicId).toBe("home/e1/state");

    applyEntityDeclarations(registry, [
      makeDecl({ label: "E1 renamed", memberTopics: ["home/e1/new_state"] }),
    ]);

    expect(registry.topicIndex.has("home/e1/state")).toBe(false);
    expect(registry.topicIndex.get("home/e1/new_state")![0].kind).toBe("primary");
    const updated = registry.entities.get("homeassistant:ent:e1")!;
    expect(updated.label).toBe("E1 renamed");
    // Seen topics and anchor survive the re-declaration.
    expect(updated.anchorTopicId).toBe("home/e1/state");
    expect(updated.topicNodeIds.has("home/e1/state")).toBe(true);
  });

  it("enforces the entity cap for new entities", () => {
    for (let i = 0; i < DOMAIN_ENTITY_CAP; i++) {
      registry.entities.set(`k${i}`, {
        key: `k${i}`, ecosystem: "homeassistant", role: "sensor", label: `k${i}`,
        parentKey: null, online: null, attributes: {}, anchorTopicId: null,
        topicNodeIds: new Set(),
      });
    }
    const changed = applyEntityDeclarations(registry, [makeDecl({ key: "homeassistant:ent:overflow" })]);
    expect(changed).toBe(false);
    expect(registry.entities.has("homeassistant:ent:overflow")).toBe(false);
  });

  it("records topic hits: members, anchor upgrade, availability flips", () => {
    applyEntityDeclarations(registry, [
      makeDecl({
        memberTopics: ["home/e1/state", "home/e1/attrs"],
        availability: [
          { topic: "home/e1/lwt", payloadAvailable: "online", payloadNotAvailable: "offline" },
        ],
      }),
    ]);
    const entity = registry.entities.get("homeassistant:ent:e1")!;

    // Member topic seen first — becomes the provisional anchor.
    const memberHit = recordEntityTopicHit(registry, "home/e1/attrs", "home/e1/attrs", "{}");
    expect(memberHit!.changed).toBe(true);
    expect(entity.anchorTopicId).toBe("home/e1/attrs");

    // Primary topic seen — anchor upgrades.
    recordEntityTopicHit(registry, "home/e1/state", "home/e1/state", "21.5");
    expect(entity.anchorTopicId).toBe("home/e1/state");
    expect(entity.topicNodeIds.size).toBe(2);

    // Availability payloads flip online; unknown payloads leave it alone.
    recordEntityTopicHit(registry, "home/e1/lwt", "home/e1/lwt", "online");
    expect(entity.online).toBe(true);
    recordEntityTopicHit(registry, "home/e1/lwt", "home/e1/lwt", "garbage");
    expect(entity.online).toBe(true);
    recordEntityTopicHit(registry, "home/e1/lwt", "home/e1/lwt", "offline");
    expect(entity.online).toBe(false);

    // Unclaimed topics miss.
    expect(recordEntityTopicHit(registry, "other/topic", "other/topic", "x")).toBeNull();
  });

  it("tombstones remove the entity, its claims, and a childless device", () => {
    const device = makeDecl({
      key: "homeassistant:dev:d1", role: "device", label: "D1",
      memberTopics: [], sourceTopic: "homeassistant/sensor/e1/config",
    });
    applyEntityDeclarations(registry, [
      device,
      makeDecl({ parentKey: "homeassistant:dev:d1" }),
    ]);

    expect(applyConfigTombstone(registry, "homeassistant/sensor/e1/config")).toBe(true);
    expect(registry.entities.has("homeassistant:ent:e1")).toBe(false);
    expect(registry.entities.has("homeassistant:dev:d1")).toBe(false);
    expect(registry.topicIndex.has("home/e1/state")).toBe(false);
  });

  it("pruned nodes are dropped from seen topics and anchors re-point", () => {
    applyEntityDeclarations(registry, [
      makeDecl({ memberTopics: ["home/e1/state", "home/e1/attrs"] }),
    ]);
    recordEntityTopicHit(registry, "home/e1/attrs", "home/e1/attrs", "{}");
    recordEntityTopicHit(registry, "home/e1/state", "home/e1/state", "21.5");
    const entity = registry.entities.get("homeassistant:ent:e1")!;
    expect(entity.anchorTopicId).toBe("home/e1/state");

    // Anchor node pruned — falls back to the other seen member.
    expect(removeEntityNodeRef(registry, "home/e1/state")).toBe(true);
    expect(entity.topicNodeIds.has("home/e1/state")).toBe(false);
    expect(entity.anchorTopicId).toBe("home/e1/attrs");

    // Last seen node pruned — anchor clears; the entity itself survives.
    removeEntityNodeRef(registry, "home/e1/attrs");
    expect(entity.anchorTopicId).toBeNull();
    expect(registry.entities.has("homeassistant:ent:e1")).toBe(true);

    // Re-publishing on a claimed topic re-binds the recreated node.
    recordEntityTopicHit(registry, "home/e1/state", "home/e1/state", "22");
    expect(entity.anchorTopicId).toBe("home/e1/state");

    // Unclaimed node ids are no-ops.
    expect(removeEntityNodeRef(registry, "other/topic")).toBe(false);
  });

  it("tombstones keep a device that still has other children", () => {
    const device = makeDecl({
      key: "homeassistant:dev:d1", role: "device", label: "D1", memberTopics: [],
    });
    applyEntityDeclarations(registry, [
      device,
      makeDecl({ parentKey: "homeassistant:dev:d1" }),
      makeDecl({
        key: "homeassistant:ent:e2", parentKey: "homeassistant:dev:d1",
        memberTopics: ["home/e2/state"], sourceTopic: "homeassistant/sensor/e2/config",
      }),
    ]);

    applyConfigTombstone(registry, "homeassistant/sensor/e1/config");
    expect(registry.entities.has("homeassistant:ent:e1")).toBe(false);
    expect(registry.entities.has("homeassistant:ent:e2")).toBe(true);
    expect(registry.entities.has("homeassistant:dev:d1")).toBe(true);

    // Unknown tombstones are no-ops.
    expect(applyConfigTombstone(registry, "homeassistant/sensor/nope/config")).toBe(false);
  });
});
