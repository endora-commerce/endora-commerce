/// <reference path="../types/leaflet.d.ts" />
'use client';

import { useEffect, useRef } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import type { BreakpointTier } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { MapProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';

function ensureLeafletCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-cmsc-leaflet-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  link.crossOrigin = '';
  link.setAttribute('data-cmsc-leaflet-css', '1');
  document.head.appendChild(link);
}

function googleEmbedUrl(props: MapProps): string | null {
  const key = props.googleApiKey?.trim();
  if (!key) return null;
  const lat = props.centerLat ?? 52.2297;
  const lng = props.centerLng ?? 21.0122;
  const zoom = props.zoom ?? 12;
  return `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${lat},${lng}&zoom=${zoom}`;
}

type LeafletMapHandle = {
  remove: () => void;
  invalidateSize: (opts?: { animate?: boolean }) => void;
};

function LeafletMap({
  centerLat,
  centerLng,
  zoom,
  markers,
  height,
}: {
  centerLat: number;
  centerLng: number;
  zoom: number;
  markers: MapProps['markers'];
  height: number;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapHandle | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      try {
        ensureLeafletCss();
        const leaflet = await import('leaflet');
        if (cancelled) return;

        // Default marker icons break under bundlers without explicit URLs — use circle markers.
        const map = leaflet
          .map(el, {
            scrollWheelZoom: false,
          })
          .setView([centerLat, centerLng], zoom);

        leaflet
          .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
          })
          .addTo(map);

        for (const m of markers ?? []) {
          leaflet
            .circleMarker([m.lat, m.lng], {
              radius: 8,
              color: '#0f766e',
              fillColor: '#14b8a6',
              fillOpacity: 0.9,
              weight: 2,
            })
            .addTo(map)
            .bindPopup(m.label ?? '');
        }

        const invalidate = (): void => {
          map.invalidateSize({ animate: false });
        };
        // Layout may settle after paint (editor iframe / flex parents).
        requestAnimationFrame(invalidate);
        window.setTimeout(invalidate, 50);
        window.setTimeout(invalidate, 250);

        resizeObserver = new ResizeObserver(() => invalidate());
        resizeObserver.observe(el.parentElement ?? el);

        mapRef.current = map;
      } catch {
        if (el && !cancelled) {
          el.innerHTML =
            '<p style="padding:12px;color:#64748b">Leaflet not available — install leaflet on storefront</p>';
        }
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [centerLat, centerLng, zoom, markers]);

  useEffect(() => {
    mapRef.current?.invalidateSize({ animate: false });
  }, [height]);

  return <div ref={containerRef} className="cmsc-pb-map__leaflet" />;
}

function MapBody({
  props,
  tier,
  editing,
}: {
  props: MapProps & { puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement {
  const {
    provider = 'leaflet',
    height = 360,
    centerLat = 52.2297,
    centerLng = 21.0122,
    zoom = 12,
    markers = [],
    puck: _puck,
    ...box
  } = props;
  const heightPx = resolveResponsiveNumber(height, tier, 360);
  const embed = provider === 'google' ? googleEmbedUrl(props) : null;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <div className="cmsc-pb-map" style={{ height: `${heightPx}px` }}>
        {provider === 'google' ? (
          embed ? (
            <iframe
              title="Map"
              src={embed}
              className="cmsc-pb-map__iframe"
              style={{ height: '100%' }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <p className="cmsc:text-sm cmsc:text-[#64748b] cmsc:p-3">
              {editing ? 'Enter Google Maps API key for embed' : 'Map unavailable'}
            </p>
          )
        ) : (
          <LeafletMap
            centerLat={centerLat}
            centerLng={centerLng}
            zoom={zoom}
            markers={markers}
            height={heightPx}
          />
        )}
      </div>
    </BoxStyled>
  );
}

const MapEditingRender: PuckComponent<MapProps> = (props) => (
  <MapBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const MapPublishedRender: PuckComponent<MapProps> = (props) => (
  <MapBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const MAP_FIELDS = {
  provider: {
    type: 'select' as const,
    label: 'Provider',
    options: [
      { label: 'Leaflet + OpenStreetMap', value: 'leaflet' },
      { label: 'Google Maps (embed)', value: 'google' },
    ],
  },
  googleApiKey: { type: 'text' as const, label: 'Google API key (embed)' },
  height: {
    type: 'number' as const,
    label: 'Height (px)',
    min: 200,
    max: 800,
    metadata: PB_RESPONSIVE_METADATA,
  },
  centerLat: { type: 'number' as const, label: 'Center latitude' },
  centerLng: { type: 'number' as const, label: 'Center longitude' },
  zoom: { type: 'number' as const, label: 'Zoom', min: 1, max: 18 },
  markers: {
    type: 'array' as const,
    label: 'Markers',
    arrayFields: {
      lat: { type: 'number' as const, label: 'Latitude' },
      lng: { type: 'number' as const, label: 'Longitude' },
      label: { type: 'text' as const, label: 'Label' },
      link: { type: 'text' as const, label: 'Link URL' },
    },
    defaultItemProps: { lat: 52.23, lng: 21.01, label: '', link: '' },
  },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const mapConfig: ComponentConfig<MapProps> = {
  label: 'Map',
  fields: MAP_FIELDS,
  defaultProps: {
    provider: 'leaflet',
    height: 360,
    centerLat: 52.2297,
    centerLng: 21.0122,
    zoom: 12,
    googleApiKey: '',
    markers: [],
    ...DEFAULT_BOX_PROPS,
  },
  resolveFields: (data) => {
    if (data.props.provider === 'google') return MAP_FIELDS;
    const { googleApiKey: _key, ...rest } = MAP_FIELDS;
    return rest;
  },
  render: (props) =>
    props.puck?.isEditing ? <MapEditingRender {...props} /> : <MapPublishedRender {...props} />,
};

export const Map = withHideOn(mapConfig);
