import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import {
  loadIndiaRailNetwork,
  pointInBounds,
  routeInBounds,
  simplifyRoute,
  type RailRoute,
  type RailStation,
  type ViewBounds
} from "./indiaRailNetwork";

export interface RailLayerOptions {
  bounds: ViewBounds;
  zoom: number;
}

function routeColor(route: RailRoute): [number, number, number, number] {
  if (route.ghat || route.line === "single") return [200, 160, 60, 210];
  return [90, 130, 150, 185];
}

function routeWidth(zoom: number): number {
  if (zoom < 5) return 1;
  if (zoom < 7) return 1.25;
  return 1.5;
}

export function buildRailNetworkLayers(opts: RailLayerOptions): Layer[] {
  const { bounds, zoom } = opts;
  const net = loadIndiaRailNetwork();

  const routes = net.routes
    .filter((r) => routeInBounds(r, bounds))
    .map((r) => ({
      ...r,
      path: simplifyRoute(r.geometry, zoom)
    }));

  const showAllStations = zoom >= 5.5;
  const stations: RailStation[] = net.stations.filter((s) => {
    if (!pointInBounds(s.lng, s.lat, bounds)) return false;
    if (showAllStations) return true;
    return s.major;
  });

  const showLabels = zoom >= 7.5;
  const labelStations = showLabels ? stations.filter((s) => s.major) : [];

  const glowRoutes = routes.map((r) => ({ path: r.path }));

  const layers: Layer[] = [
    new PathLayer({
      id: "rail-glow",
      data: glowRoutes,
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [58, 208, 222, 28],
      getWidth: routeWidth(zoom) + 2.5,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new PathLayer({
      id: "rail-routes",
      data: routes,
      getPath: (d: RailRoute & { path: [number, number][] }) => d.path,
      getColor: (d: RailRoute) => routeColor(d),
      getWidth: routeWidth(zoom),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: { depthTest: false }
    }),
    new ScatterplotLayer({
      id: "rail-stations",
      data: stations,
      getPosition: (d: RailStation) => [d.lng, d.lat],
      getRadius: zoom >= 8 ? 3.5 : 2.5,
      radiusUnits: "pixels",
      getFillColor: [140, 155, 170, zoom >= 5 ? 200 : 140],
      getLineColor: [20, 24, 32, 200],
      lineWidthMinPixels: 1,
      stroked: true,
      parameters: { depthTest: false }
    })
  ];

  if (labelStations.length > 0) {
    layers.push(
      new TextLayer({
        id: "rail-station-labels",
        data: labelStations,
        getPosition: (d: RailStation) => [d.lng, d.lat],
        getText: (d: RailStation) => d.code,
        getSize: 11,
        getColor: [153, 161, 173, 220],
        getPixelOffset: [0, 10],
        fontFamily: "monospace",
        fontWeight: 600,
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "top",
        billboard: true,
        parameters: { depthTest: false }
      })
    );
  }

  return layers;
}
