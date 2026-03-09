import { describe, it, expect } from "vitest";
import { detectGeo } from "../geoDetector";

describe("detectGeo", () => {
  // --- Positive detections ---

  it("should detect flat lat/lon pair", () => {
    const results = detectGeo({ lat: 51.5074, lon: -0.1278 });
    expect(results).toHaveLength(1);
    expect(results[0].tag).toBe("geo");
    expect(results[0].metadata.lat).toBe(51.5074);
    expect(results[0].metadata.lon).toBe(-0.1278);
    expect(results[0].metadata.latPath).toBe("lat");
    expect(results[0].metadata.lonPath).toBe("lon");
    expect(results[0].confidence).toBe(0.9);
  });

  it("should detect latitude/longitude pair with full confidence", () => {
    const results = detectGeo({ latitude: 40.7128, longitude: -74.006 });
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe(1.0);
    expect(results[0].metadata.lat).toBe(40.7128);
    expect(results[0].metadata.lon).toBe(-74.006);
    expect(results[0].metadata.latPath).toBe("latitude");
    expect(results[0].metadata.lonPath).toBe("longitude");
  });

  it("should detect lat/lng pair", () => {
    const results = detectGeo({ lat: -33.8688, lng: 151.2093 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(-33.8688);
    expect(results[0].metadata.lon).toBe(151.2093);
    expect(results[0].confidence).toBe(0.9);
  });

  it("should detect lat/long pair", () => {
    const results = detectGeo({ lat: 35.6762, long: 139.6503 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(35.6762);
    expect(results[0].metadata.lon).toBe(139.6503);
    expect(results[0].confidence).toBe(0.85);
  });

  it("should detect nested coordinates", () => {
    const results = detectGeo({
      sensor: "gps-01",
      position: { latitude: 48.8566, longitude: 2.3522 },
    });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(48.8566);
    expect(results[0].metadata.lon).toBe(2.3522);
    expect(results[0].metadata.latPath).toBe("position.latitude");
    expect(results[0].metadata.lonPath).toBe("position.longitude");
    expect(results[0].fieldPath).toBe("position");
  });

  it("should detect deeply nested coordinates", () => {
    const results = detectGeo({
      data: {
        vehicle: {
          location: { lat: 52.52, lon: 13.405 },
        },
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.latPath).toBe("data.vehicle.location.lat");
    expect(results[0].metadata.lonPath).toBe("data.vehicle.location.lon");
  });

  it("should detect coordinates inside arrays", () => {
    const results = detectGeo({
      waypoints: [
        { lat: 51.5, lon: -0.1 },
        { lat: 48.85, lon: 2.35 },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0].metadata.lat).toBe(51.5);
    expect(results[1].metadata.lat).toBe(48.85);
    expect(results[0].metadata.latPath).toBe("waypoints.[0].lat");
    expect(results[1].metadata.latPath).toBe("waypoints.[1].lat");
  });

  it("should detect case-insensitive keys", () => {
    const results = detectGeo({ Lat: 10, Lon: 20 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(10);
    expect(results[0].metadata.lon).toBe(20);
  });

  it("should detect UPPERCASE keys", () => {
    const results = detectGeo({ LATITUDE: -45.0, LONGITUDE: 170.0 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(-45.0);
    expect(results[0].metadata.lon).toBe(170.0);
  });

  it("should detect multiple geo pairs in one object", () => {
    const results = detectGeo({
      start: { lat: 51.5, lon: -0.1 },
      end: { lat: 48.85, lon: 2.35 },
    });
    expect(results).toHaveLength(2);
  });

  it("should detect coordinates at boundary values", () => {
    // Exact boundary: lat=90, lon=180
    const results = detectGeo({ lat: 90, lon: 180 });
    expect(results).toHaveLength(1);

    // Negative boundaries
    const results2 = detectGeo({ lat: -90, lon: -180 });
    expect(results2).toHaveLength(1);
  });

  it("should detect coordinates at zero", () => {
    const results = detectGeo({ lat: 0, lon: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(0);
    expect(results[0].metadata.lon).toBe(0);
  });

  // --- Negative detections (should NOT detect) ---

  it("should reject lat out of range (> 90)", () => {
    const results = detectGeo({ lat: 91, lon: 0 });
    expect(results).toHaveLength(0);
  });

  it("should reject lon out of range (> 180)", () => {
    const results = detectGeo({ lat: 0, lon: 181 });
    expect(results).toHaveLength(0);
  });

  it("should reject negative lat out of range (< -90)", () => {
    const results = detectGeo({ lat: -91, lon: 0 });
    expect(results).toHaveLength(0);
  });

  it("should reject negative lon out of range (< -180)", () => {
    const results = detectGeo({ lat: 0, lon: -181 });
    expect(results).toHaveLength(0);
  });

  it("should accept numeric string lat", () => {
    const results = detectGeo({ lat: "51.5", lon: -0.1 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(51.5);
    expect(results[0].metadata.lon).toBe(-0.1);
  });

  it("should reject non-numeric string lon", () => {
    const results = detectGeo({ lat: 51.5, lon: "not a number" });
    expect(results).toHaveLength(0);
  });

  it("should reject NaN values", () => {
    const results = detectGeo({ lat: NaN, lon: 0 });
    expect(results).toHaveLength(0);
  });

  it("should reject Infinity values", () => {
    const results = detectGeo({ lat: Infinity, lon: 0 });
    expect(results).toHaveLength(0);
  });

  it("should return empty for objects without lat/lon keys", () => {
    const results = detectGeo({ temperature: 22.5, humidity: 65 });
    expect(results).toHaveLength(0);
  });

  it("should return empty for only lat without lon", () => {
    const results = detectGeo({ lat: 51.5, altitude: 100 });
    expect(results).toHaveLength(0);
  });

  // --- Edge cases ---

  it("should return empty for null", () => {
    const results = detectGeo(null);
    expect(results).toHaveLength(0);
  });

  it("should return empty for undefined", () => {
    const results = detectGeo(undefined);
    expect(results).toHaveLength(0);
  });

  it("should return empty for a string", () => {
    const results = detectGeo("not an object");
    expect(results).toHaveLength(0);
  });

  it("should return empty for a number", () => {
    const results = detectGeo(42);
    expect(results).toHaveLength(0);
  });

  it("should return empty for an empty object", () => {
    const results = detectGeo({});
    expect(results).toHaveLength(0);
  });

  it("should return empty for an empty array", () => {
    const results = detectGeo([]);
    expect(results).toHaveLength(0);
  });

  it("should return empty for a boolean", () => {
    const results = detectGeo(true);
    expect(results).toHaveLength(0);
  });

  // --- Deduplication: lat/lon and latitude/longitude in same object ---

  it("should detect both pairs when object has lat/lon AND latitude/longitude", () => {
    // Both pairs are valid — report both so the consumer can pick by confidence
    const results = detectGeo({
      lat: 51.5,
      lon: -0.1,
      latitude: 51.5074,
      longitude: -0.1278,
    });
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The latitude/longitude pair should have higher confidence
    const highConf = results.find((r) => r.confidence === 1.0);
    expect(highConf).toBeDefined();
    expect(highConf!.metadata.lat).toBe(51.5074);
  });

  // --- Real-world payload shapes ---

  it("should detect geo in a typical IoT GPS payload", () => {
    const payload = {
      deviceId: "tracker-01",
      timestamp: 1709913600000,
      gps: {
        latitude: 37.7749,
        longitude: -122.4194,
        altitude: 16.2,
        speed: 0,
        satellites: 12,
      },
      battery: 87,
    };
    const results = detectGeo(payload);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(37.7749);
    expect(results[0].metadata.lon).toBe(-122.4194);
    expect(results[0].metadata.latPath).toBe("gps.latitude");
    expect(results[0].metadata.lonPath).toBe("gps.longitude");
    expect(results[0].confidence).toBe(1.0);
  });

  it("should detect geo in a GeoJSON-like position object", () => {
    const payload = {
      type: "Feature",
      properties: { name: "Test Point" },
      geometry: {
        type: "Point",
        coordinates: { lat: 51.505, lng: -0.09 },
      },
    };
    const results = detectGeo(payload);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(51.505);
    expect(results[0].metadata.lon).toBe(-0.09);
  });

  // --- String value coercion ---

  it("should detect string lat and lon values", () => {
    const results = detectGeo({ latitude: "53.5511", longitude: "9.9937" });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(53.5511);
    expect(results[0].metadata.lon).toBe(9.9937);
    expect(results[0].confidence).toBe(1.0);
  });

  it("should detect mixed string lat and numeric lon", () => {
    const results = detectGeo({ lat: "51.5074", lon: -0.1278 });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(51.5074);
    expect(results[0].metadata.lon).toBe(-0.1278);
  });

  it("should detect nested string coordinates", () => {
    const results = detectGeo({
      location: { latitude: "48.8566", longitude: "2.3522" },
      temp: "18.5",
    });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(48.8566);
    expect(results[0].metadata.lon).toBe(2.3522);
    expect(results[0].metadata.latPath).toBe("location.latitude");
  });

  it("should detect negative string coordinates", () => {
    const results = detectGeo({ lat: "-33.8688", lng: "151.2093" });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(-33.8688);
    expect(results[0].metadata.lon).toBe(151.2093);
  });

  it("should detect string coordinates at boundary values", () => {
    const results = detectGeo({ lat: "90", lon: "-180" });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(90);
    expect(results[0].metadata.lon).toBe(-180);
  });

  it("should reject string lat out of range", () => {
    const results = detectGeo({ lat: "91", lon: "0" });
    expect(results).toHaveLength(0);
  });

  it("should reject empty string lat", () => {
    const results = detectGeo({ lat: "", lon: "0" });
    expect(results).toHaveLength(0);
  });

  it("should reject whitespace-only string lat", () => {
    const results = detectGeo({ lat: "   ", lon: "0" });
    expect(results).toHaveLength(0);
  });

  it("should handle string coords with leading/trailing whitespace", () => {
    const results = detectGeo({ lat: " 51.5 ", lon: " -0.1 " });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.lat).toBe(51.5);
    expect(results[0].metadata.lon).toBe(-0.1);
  });

  it("should reject boolean values", () => {
    const results = detectGeo({ lat: true, lon: false });
    expect(results).toHaveLength(0);
  });
});
