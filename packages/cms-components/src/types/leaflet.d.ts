declare module 'leaflet' {
  export function map(el: HTMLElement): {
    setView: (center: [number, number], zoom: number) => { remove: () => void };
  };
  export function tileLayer(url: string, opts: { attribution: string }): { addTo: (map: unknown) => unknown };
  export function marker(latlng: [number, number]): { addTo: (map: unknown) => { bindPopup: (html: string) => unknown } };
}
