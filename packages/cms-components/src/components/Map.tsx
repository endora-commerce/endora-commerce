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

function googleEmbedUrl(props: MapProps): string | null {
  const key = props.googleApiKey?.trim();
  if (!key) return null;
  const lat = props.centerLat ?? 52.2297;
  const lng = props.centerLng ?? 21.0122;
  const zoom = props.zoom ?? 12;
  return `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${lat},${lng}&zoom=${zoom}`;
}

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
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      try {
        const leaflet = await import('leaflet');
        if (cancelled) return;
        const map = leaflet.map(el).setView([centerLat, centerLng], zoom);
        leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        for (const m of markers ?? []) {
          leaflet.marker([m.lat, m.lng]).addTo(map).bindPopup(m.label ?? '');
        }
        mapRef.current = map;
      } catch {
        if (el) el.innerHTML = '<p style="padding:12px;color:#64748b">Leaflet not available — install leaflet on storefront</p>';
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [centerLat, centerLng, zoom, markers]);

  return <div ref={containerRef} style={{ height: `${height}px`, width: '100%' }} />;
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
      <div className="cmsc-pb-map">
        {provider === 'google' ? (
          embed ? (
            <iframe
              title="Map"
              src={embed}
              className="cmsc-pb-map__iframe"
              style={{ height: `${heightPx}px` }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <p className="cmsc:text-sm cmsc:text-[#64748b]">
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

const mapConfig: ComponentConfig<MapProps> = {
  label: 'Map',
  fields: {
    provider: {
      type: 'select',
      label: 'Provider',
      options: [
        { label: 'Leaflet + OpenStreetMap', value: 'leaflet' },
        { label: 'Google Maps (embed)', value: 'google' },
      ],
    },
    height: { type: 'number', label: 'Height (px)', min: 200, max: 800, metadata: PB_RESPONSIVE_METADATA },
    centerLat: { type: 'number', label: 'Center latitude' },
    centerLng: { type: 'number', label: 'Center longitude' },
    zoom: { type: 'number', label: 'Zoom', min: 1, max: 18 },
    googleApiKey: { type: 'text', label: 'Google API key (embed)' },
    markers: {
      type: 'array',
      label: 'Markers',
      arrayFields: {
        lat: { type: 'number', label: 'Latitude' },
        lng: { type: 'number', label: 'Longitude' },
        label: { type: 'text', label: 'Label' },
        link: { type: 'text', label: 'Link URL' },
      },
      defaultItemProps: { lat: 52.23, lng: 21.01, label: '', link: '' },
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
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
  render: (props) =>
    props.puck?.isEditing ? <MapEditingRender {...props} /> : <MapPublishedRender {...props} />,
};

export const Map = withHideOn(mapConfig);
