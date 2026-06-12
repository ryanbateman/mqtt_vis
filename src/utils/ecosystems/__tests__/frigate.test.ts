import { describe, it, expect, beforeEach } from "vitest";
import { recordFrigateMessage } from "../frigate";
import { createEntityRegistry, type EntityRegistry } from "../entityOps";

describe("recordFrigateMessage", () => {
  let registry: EntityRegistry;
  beforeEach(() => {
    registry = createEntityRegistry();
  });

  it("ignores non-frigate topics", () => {
    expect(recordFrigateMessage(registry, "home/temp", "home/temp", "21")).toBeNull();
    expect(registry.entities.size).toBe(0);
  });

  it("creates the NVR from frigate/available and tracks its LWT", () => {
    const hit = recordFrigateMessage(registry, "frigate/available", "frigate/available", "online")!;
    expect(hit.entity.key).toBe("frigate:nvr");
    expect(hit.entity.role).toBe("nvr");
    expect(hit.entity.online).toBe(true);
    expect(hit.entity.anchorTopicId).toBe("frigate/available");
    expect(hit.changed).toBe(true);

    recordFrigateMessage(registry, "frigate/available", "frigate/available", "offline");
    expect(registry.entities.get("frigate:nvr")!.online).toBe(false);
  });

  it("derives camera entities from per-camera topic trees", () => {
    const hit = recordFrigateMessage(
      registry,
      "frigate/front_door/person/snapshot",
      "frigate/front_door/person/snapshot",
      "ÿØjpeg-bytes",
    )!;

    expect(hit.entity.key).toBe("frigate:cam:front_door");
    expect(hit.entity.role).toBe("camera");
    expect(hit.entity.label).toBe("front_door");
    expect(hit.entity.parentKey).toBe("frigate:nvr");
    expect(hit.entity.anchorTopicId).toBe("frigate/front_door/person/snapshot");
    // The NVR parent is created implicitly so the panel can group cameras.
    expect(registry.entities.has("frigate:nvr")).toBe(true);

    recordFrigateMessage(registry, "frigate/front_door/motion", "frigate/front_door/motion", "ON");
    const camera = registry.entities.get("frigate:cam:front_door")!;
    expect(camera.topicNodeIds.size).toBe(2);
    // Anchor stays at the first seen topic.
    expect(camera.anchorTopicId).toBe("frigate/front_door/person/snapshot");
  });

  it("binds reserved NVR-level topics to the NVR, not a camera", () => {
    const hit = recordFrigateMessage(registry, "frigate/events", "frigate/events", "{}")!;
    expect(hit.entity.key).toBe("frigate:nvr");
    expect(registry.entities.has("frigate:cam:events")).toBe(false);

    const stats = recordFrigateMessage(registry, "frigate/stats", "frigate/stats", "{}")!;
    expect(stats.entity.key).toBe("frigate:nvr");
  });
});
