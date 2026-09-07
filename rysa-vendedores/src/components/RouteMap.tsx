import React, { useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapClientPoint {
  id: string;
  nombre: string;
  latitud: number;
  longitud: number;
  orden?: number;
  estado?: string;
  direccion?: string;
  telefono?: string;
}

interface RouteMapProps {
  sellerLocation: { latitud: number; longitud: number };
  clients: MapClientPoint[];
  routeCoordinates?: Array<[number, number]>; // [lat, lng]
  selectedClientId?: string;
  height?: number;
}

export const RouteMap: React.FC<RouteMapProps> = ({
  sellerLocation,
  clients,
  routeCoordinates = [],
  selectedClientId,
  height = 280,
}) => {
  const htmlContent = useMemo(() => {
    const validClients = clients.filter(
      (c) =>
        typeof c.latitud === 'number' &&
        typeof c.longitud === 'number' &&
        !isNaN(c.latitud) &&
        !isNaN(c.longitud) &&
        Math.abs(c.latitud) > 0.1
    );

    const clientsJson = JSON.stringify(validClients);
    const sellerJson = JSON.stringify(sellerLocation);
    const routeJson = JSON.stringify(routeCoordinates);
    const selId = JSON.stringify(selectedClientId || '');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .seller-marker {
      width: 18px; height: 18px; background: #2563eb; border: 3px solid #ffffff;
      border-radius: 50%; box-shadow: 0 0 12px rgba(37,99,235,0.8);
      position: relative;
    }
    .seller-pulse {
      position: absolute; top: -6px; left: -6px; width: 24px; height: 24px;
      border-radius: 50%; background: rgba(37,99,235,0.35);
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.8); opacity: 1; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .client-marker {
      background: #D32F2F; color: white; border: 2px solid white;
      border-radius: 50%; width: 26px; height: 26px; display: flex;
      align-items: center; justify-content: center; font-weight: 800;
      font-size: 11px; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    }
    .client-marker.visited {
      background: #2E7D32;
    }
    .client-marker.selected {
      border: 3px solid #FFD600;
      transform: scale(1.15);
      box-shadow: 0 0 10px #FFD600;
    }
    .popup-box {
      font-size: 12px; line-height: 1.4; color: #1a202c;
    }
    .popup-title {
      font-weight: 800; font-size: 13px; color: #121820; margin-bottom: 2px;
    }
    .popup-sub {
      color: #718096; font-size: 11px;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    try {
      var seller = ${sellerJson};
      var clients = ${clientsJson};
      var routeCoords = ${routeJson};
      var selectedId = ${selId};

      var centerLat = seller.latitud || 17.5095;
      var centerLng = seller.longitud || -91.9827;

      var map = L.map('map', {
        zoomControl: true,
        attributionControl: false
      }).setView([centerLat, centerLng], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      var bounds = [];

      // 1. Marcador del Vendedor
      if (seller.latitud && seller.longitud) {
        var sIcon = L.divIcon({
          className: '',
          html: '<div class="seller-pulse"></div><div class="seller-marker"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        L.marker([seller.latitud, seller.longitud], { icon: sIcon })
          .addTo(map)
          .bindPopup('<div class="popup-box"><div class="popup-title">📍 Tu Ubicación GPS</div><div class="popup-sub">Asesor en Campo (Palenque)</div></div>');
        bounds.push([seller.latitud, seller.longitud]);
      }

      // 2. Marcadores de Clientes
      clients.forEach(function(cli, idx) {
        var orderNum = cli.orden != null ? cli.orden : (idx + 1);
        var isDone = cli.estado === 'realizada';
        var isSel = cli.id === selectedId;

        var cls = 'client-marker' + (isDone ? ' visited' : '') + (isSel ? ' selected' : '');
        var cIcon = L.divIcon({
          className: '',
          html: '<div class="' + cls + '">' + orderNum + '</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        var m = L.marker([cli.latitud, cli.longitud], { icon: cIcon }).addTo(map);
        m.bindPopup(
          '<div class="popup-box">' +
            '<div class="popup-title">#' + orderNum + ' ' + (cli.nombre || 'Cliente') + '</div>' +
            '<div class="popup-sub">' + (cli.direccion || '') + '</div>' +
            (isDone ? '<div style="color:#2E7D32;font-weight:700;margin-top:4px;">✓ Visita Realizada</div>' : '<div style="color:#D32F2F;font-weight:700;margin-top:4px;">• Pendiente de Visita</div>') +
          '</div>'
        );

        bounds.push([cli.latitud, cli.longitud]);
      });

      // 3. Trazo de Ruta OSRM / Polilínea
      if (routeCoords && routeCoords.length > 1) {
        L.polyline(routeCoords, {
          color: '#2563eb',
          weight: 4,
          opacity: 0.85,
          lineJoin: 'round'
        }).addTo(map);
      } else if (bounds.length > 1) {
        // Fallback: línea directa entre paradas
        L.polyline(bounds, {
          color: '#f59e0b',
          weight: 3,
          dashArray: '5, 8',
          opacity: 0.75
        }).addTo(map);
      }

      // 4. Ajustar encuadre
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 15);
      }
    } catch(err) {
      console.error(err);
    }
  </script>
</body>
</html>
    `;
  }, [sellerLocation, clients, routeCoordinates, selectedClientId]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { height }]}>
        <iframe
          srcDoc={htmlContent}
          style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12 }}
          title="Ruta GPS"
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        nestedScrollEnabled={true}
        scrollEnabled={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    backgroundColor: '#E2E8F0',
    marginVertical: 10,
  },
  webview: {
    flex: 1,
    backgroundColor: '#F0F2F5',
  },
});
