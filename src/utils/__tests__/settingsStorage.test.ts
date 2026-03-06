import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadSavedSettings,
  persistSettings,
  clearSavedSettings,
  type SavedSettings,
} from "../settingsStorage";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const STORAGE_KEY = "mqtt_settings";

/** Minimal in-memory localStorage shim for Node/Vitest. */
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? this.store[key]
      : null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

const localStorageMock = new LocalStorageMock();

beforeEach(() => {
  localStorageMock.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  localStorageMock.clear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeRaw(data: object): void {
  localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
}

function readRaw(): object | null {
  const raw = localStorageMock.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------------------
// loadSavedSettings
// ---------------------------------------------------------------------------

describe("loadSavedSettings", () => {
  it("returns {} when nothing is stored", () => {
    expect(loadSavedSettings()).toEqual({});
  });

  it("returns {} when the key is missing", () => {
    localStorageMock.setItem("other_key", "{}");
    expect(loadSavedSettings()).toEqual({});
  });

  it("returns {} for corrupt JSON", () => {
    localStorageMock.setItem(STORAGE_KEY, "not json {{{");
    expect(loadSavedSettings()).toEqual({});
  });

  it("returns {} for a non-object JSON value", () => {
    localStorageMock.setItem(STORAGE_KEY, '"a string"');
    expect(loadSavedSettings()).toEqual({});
  });

  it("returns {} when _version is missing", () => {
    writeRaw({ emaTau: 3 });
    expect(loadSavedSettings()).toEqual({});
  });

  it("returns {} when _version does not match", () => {
    writeRaw({ _version: 999, emaTau: 3 });
    expect(loadSavedSettings()).toEqual({});
  });

  it("returns valid fields from a correct payload", () => {
    writeRaw({ _version: 1, emaTau: 3, showLabels: false, nodeScale: 1.5 });
    const result = loadSavedSettings();
    expect(result.emaTau).toBe(3);
    expect(result.showLabels).toBe(false);
    expect(result.nodeScale).toBe(1.5);
  });

  it("drops fields with wrong types rather than rejecting the whole object", () => {
    writeRaw({ _version: 1, emaTau: "not a number", showLabels: false });
    const result = loadSavedSettings();
    expect(result.emaTau).toBeUndefined();
    expect(result.showLabels).toBe(false);
  });

  it("drops out-of-range number fields", () => {
    // emaTau valid range: 0.5 – 30
    writeRaw({ _version: 1, emaTau: 999, nodeScale: 1.0 });
    const result = loadSavedSettings();
    expect(result.emaTau).toBeUndefined();
    expect(result.nodeScale).toBe(1.0);
  });

  it("accepts boundary values as valid", () => {
    writeRaw({ _version: 1, emaTau: 0.5, nodeScale: 5, alphaDecay: 0.001 });
    const result = loadSavedSettings();
    expect(result.emaTau).toBe(0.5);
    expect(result.nodeScale).toBe(5);
    expect(result.alphaDecay).toBe(0.001);
  });

  it("accepts labelMode 'zoom', 'depth', and 'activity'", () => {
    writeRaw({ _version: 1, labelMode: "zoom" });
    expect(loadSavedSettings().labelMode).toBe("zoom");

    writeRaw({ _version: 1, labelMode: "depth" });
    expect(loadSavedSettings().labelMode).toBe("depth");

    writeRaw({ _version: 1, labelMode: "activity" });
    expect(loadSavedSettings().labelMode).toBe("activity");
  });

  it("drops invalid labelMode values", () => {
    writeRaw({ _version: 1, labelMode: "fancy" });
    expect(loadSavedSettings().labelMode).toBeUndefined();
  });

  it("persists and restores boolean fields correctly", () => {
    writeRaw({
      _version: 1,
      ancestorPulse: false,
      showRootPath: true,
      settingsCollapsed: true,
      connectionCollapsed: false,
    });
    const result = loadSavedSettings();
    expect(result.ancestorPulse).toBe(false);
    expect(result.showRootPath).toBe(true);
    expect(result.settingsCollapsed).toBe(true);
    expect(result.connectionCollapsed).toBe(false);
  });

  it("drops non-boolean values for boolean fields", () => {
    writeRaw({ _version: 1, showLabels: 1, ancestorPulse: "yes" });
    const result = loadSavedSettings();
    expect(result.showLabels).toBeUndefined();
    expect(result.ancestorPulse).toBeUndefined();
  });

  it("drops repulsionStrength outside valid range (-500 to -20)", () => {
    writeRaw({ _version: 1, repulsionStrength: -10 }); // too high (less negative)
    expect(loadSavedSettings().repulsionStrength).toBeUndefined();

    writeRaw({ _version: 1, repulsionStrength: -600 }); // too low
    expect(loadSavedSettings().repulsionStrength).toBeUndefined();

    writeRaw({ _version: 1, repulsionStrength: -350 }); // valid
    expect(loadSavedSettings().repulsionStrength).toBe(-350);
  });
});

// ---------------------------------------------------------------------------
// persistSettings
// ---------------------------------------------------------------------------

describe("persistSettings", () => {
  it("writes a versioned JSON object to localStorage", () => {
    persistSettings({ emaTau: 7 });
    const raw = readRaw() as { _version: number; emaTau: number };
    expect(raw._version).toBe(1);
    expect(raw.emaTau).toBe(7);
  });

  it("merges with existing saved settings (partial update)", () => {
    persistSettings({ emaTau: 3, nodeScale: 2 });
    persistSettings({ showLabels: false }); // should not wipe emaTau/nodeScale
    const result = loadSavedSettings();
    expect(result.emaTau).toBe(3);
    expect(result.nodeScale).toBe(2);
    expect(result.showLabels).toBe(false);
  });

  it("overwrites a field with a new value", () => {
    persistSettings({ emaTau: 3 });
    persistSettings({ emaTau: 8 });
    expect(loadSavedSettings().emaTau).toBe(8);
  });

  it("can persist all 18 fields", () => {
    const full: SavedSettings = {
      emaTau: 5,
      nodeScale: 1.5,
      scaleNodeSizeByDepth: true,
      ancestorPulse: false,
      showRootPath: true,
      showTooltips: false,
      showLabels: true,
      labelDepthFactor: 8,
      labelMode: "depth",
      labelFontSize: 16,
      scaleTextByDepth: false,
      repulsionStrength: -200,
      linkDistance: 100,
      linkStrength: 0.3,
      collisionPadding: 5,
      alphaDecay: 0.02,
      settingsCollapsed: true,
      connectionCollapsed: false,
    };
    persistSettings(full);
    const result = loadSavedSettings();
    expect(result).toMatchObject(full);
  });

  it("silently no-ops when localStorage is unavailable", () => {
    // Simulate unavailable localStorage by making setItem throw
    const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
    localStorageMock.setItem = () => { throw new Error("Storage full"); };

    // Should not throw
    expect(() => persistSettings({ emaTau: 5 })).not.toThrow();

    localStorageMock.setItem = originalSetItem;
  });
});

// ---------------------------------------------------------------------------
// clearSavedSettings
// ---------------------------------------------------------------------------

describe("clearSavedSettings", () => {
  it("removes the localStorage key", () => {
    persistSettings({ emaTau: 5 });
    expect(localStorageMock.getItem(STORAGE_KEY)).not.toBeNull();

    clearSavedSettings();
    expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearSavedSettings()).not.toThrow();
  });

  it("causes loadSavedSettings to return {} after clearing", () => {
    persistSettings({ emaTau: 3, showLabels: false });
    clearSavedSettings();
    expect(loadSavedSettings()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("round-trip persist → load", () => {
  it("recovers all numeric settings faithfully", () => {
    const settings: SavedSettings = {
      emaTau: 7.5,
      nodeScale: 2.3,
      labelDepthFactor: 12,
      labelFontSize: 20,
      repulsionStrength: -275,
      linkDistance: 180,
      linkStrength: 0.65,
      collisionPadding: 8,
      alphaDecay: 0.015,
    };
    persistSettings(settings);
    const result = loadSavedSettings();
    for (const [key, val] of Object.entries(settings)) {
      expect(result[key as keyof SavedSettings]).toBeCloseTo(val as number, 10);
    }
  });

  it("recovers all boolean settings faithfully", () => {
    persistSettings({
      scaleNodeSizeByDepth: true,
      ancestorPulse: false,
      showRootPath: true,
      showTooltips: false,
      showLabels: true,
      scaleTextByDepth: false,
      settingsCollapsed: true,
      connectionCollapsed: false,
    });
    const result = loadSavedSettings();
    expect(result.scaleNodeSizeByDepth).toBe(true);
    expect(result.ancestorPulse).toBe(false);
    expect(result.showRootPath).toBe(true);
    expect(result.showTooltips).toBe(false);
    expect(result.showLabels).toBe(true);
    expect(result.scaleTextByDepth).toBe(false);
    expect(result.settingsCollapsed).toBe(true);
    expect(result.connectionCollapsed).toBe(false);
  });

  it("recovers labelMode 'zoom', 'depth', and 'activity'", () => {
    persistSettings({ labelMode: "depth" });
    expect(loadSavedSettings().labelMode).toBe("depth");

    persistSettings({ labelMode: "zoom" });
    expect(loadSavedSettings().labelMode).toBe("zoom");

    persistSettings({ labelMode: "activity" });
    expect(loadSavedSettings().labelMode).toBe("activity");
  });
});
