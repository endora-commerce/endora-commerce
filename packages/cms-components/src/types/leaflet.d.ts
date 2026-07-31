declare module 'leaflet' {
  export interface LeafletMap {
    setView: (center: [number, number], zoom: number) => LeafletMap;
    remove: () => void;
    invalidateSize: (opts?: { animate?: boolean }) => void;
  }

  export interface LeafletLayer {
    addTo: (map: LeafletMap) => LeafletLayer;
    bindPopup: (html: string) => LeafletLayer;
  }

  export function map(
    el: HTMLElement,
    opts?: { scrollWheelZoom?: boolean },
  ): LeafletMap;

  export function tileLayer(
    url: string,
    opts: { attribution: string },
  ): LeafletLayer;

  export function marker(latlng: [number, number]): LeafletLayer;

  export function circleMarker(
    latlng: [number, number],
    opts?: {
      radius?: number;
      color?: string;
      fillColor?: string;
      fillOpacity?: number;
      weight?: number;
    },
  ): LeafletLayer;
}

declare module 'leaflet/dist/leaflet.css' {
  const css: string;
  export default css;
}
