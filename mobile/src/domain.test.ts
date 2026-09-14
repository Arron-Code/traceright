import assert from "node:assert/strict";
import test from "node:test";
import {
  closePolygon,
  createUuid,
  evaluatePlotGeofence,
  parsePolygon,
  pointInPolygon,
  type OrganizationGeofence,
} from "./domain";

test("closePolygon produces a closed GeoJSON polygon", () => {
  const polygon = closePolygon([
    [7, 50],
    [8, 50],
    [8, 51],
  ]);

  assert.equal(polygon.type, "Polygon");
  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0][3]);
});

test("parsePolygon rejects malformed geometry", () => {
  assert.throws(() => parsePolygon('{"type":"Point","coordinates":[7,50]}'));
  assert.throws(() =>
    parsePolygon('{"type":"Polygon","coordinates":[[[7,50],[8,50]]]}'),
  );
});

test("polygon validation rejects coordinate ranges, open rings, zero area and self intersections", () => {
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[181,0],[1,0],[1,1],[181,0]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[2,0],[0,0]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,0],[0,0]]]}',
  ));
});

test("pointInPolygon includes boundary and excludes holes", () => {
  const polygon = parsePolygon(JSON.stringify({
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  }));
  assert.equal(pointInPolygon([2, 2], polygon), true);
  assert.equal(pointInPolygon([0, 5], polygon), true);
  assert.equal(pointInPolygon([5, 5], polygon), false);
  assert.equal(pointInPolygon([11, 5], polygon), false);
});

test("local geofence precheck is pending, inside, or outside", () => {
  const fence: OrganizationGeofence = {
    id: "fence-1",
    organizationId: "org-1",
    polygon: closePolygon([[0, 0], [10, 0], [10, 10], [0, 10]]),
  };
  assert.equal(evaluatePlotGeofence(closePolygon([[1, 1], [2, 1], [1, 2]]), []), "pending");
  assert.equal(
    evaluatePlotGeofence(closePolygon([[1, 1], [2, 1], [1, 2]]), [fence]),
    "inside",
  );
  assert.equal(
    evaluatePlotGeofence(closePolygon([[9, 9], [11, 9], [9, 11]]), [fence]),
    "outside",
  );
});

test("UUID identifiers have RFC 4122 version and variant bits", () => {
  assert.match(
    createUuid(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
