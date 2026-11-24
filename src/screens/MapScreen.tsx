import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Theme } from '../constants/Theme';
import { ArrowLeft, Navigation, Zap } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

export default function MapScreen({ route, navigation }: any) {
  const { originName, originLat, originLng, destName, destLat, destLng } = route.params;

  const leafletHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { padding: 0; margin: 0; font-family: sans-serif; }
        html, body, #map { height: 100%; width: 100%; }
        .marker-emoji {
          font-size: 32px;
          line-height: 32px;
          text-align: center;
          filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4));
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const origin = [${originLat}, ${originLng}];
        const dest = [${destLat}, ${destLng}];

        const map = L.map('map', { zoomControl: false });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(map);

        const originIcon = L.divIcon({ 
          className: 'custom-div-icon', 
          html: "<div class='marker-emoji'>🚚</div>",
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });
        
        const destIcon = L.divIcon({ 
          className: 'custom-div-icon', 
          html: "<div class='marker-emoji'>📍</div>",
          iconSize: [36, 36],
          iconAnchor: [18, 36]
        });

        L.marker(origin, { icon: originIcon }).addTo(map).bindPopup('<b>Starting Location:</b><br/>${originName}');
        L.marker(dest, { icon: destIcon }).addTo(map).bindPopup('<b>Destination:</b><br/>${destName}').openPopup();

        const osrmUrl = 'https://router.project-osrm.org/route/v1/driving/' + origin[1] + ',' + origin[0] + ';' + dest[1] + ',' + dest[0] + '?overview=full&geometries=geojson';
        
        fetch(osrmUrl)
          .then(response => response.json())
          .then(data => {
            if (data.routes && data.routes.length > 0) {
              const routeCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
              const polyline = L.polyline(routeCoords, {
                color: '#00875A',
                weight: 6,
                opacity: 0.85
              }).addTo(map);
              map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
            } else {
              throw new Error("No route found");
            }
          })
          .catch(err => {
            const latlngs = [origin, dest];
            const polyline = L.polyline(latlngs, {
              color: '#FACC15', 
              weight: 4,
              dashArray: '10, 10'
            }).addTo(map);
            map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
          });
      </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <WebView 
        source={{ html: leafletHTML }} 
        style={styles.map} 
        scrollEnabled={false}
        bounces={false}
      />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <ArrowLeft size={24} color={Theme.colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextContainer}>
            <View style={styles.trafficRow}>
              <Zap size={12} color="#00875A" />
              <Text style={styles.routingText}>Fastest Route • Normal CDO Traffic</Text>
            </View>
            <Text style={styles.destText} numberOfLines={1}>{destName}</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: Theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  backBtn: {
    padding: Theme.spacing.sm,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  headerTextContainer: {
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.borderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    flex: 1,
  },
  trafficRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  routingText: {
    fontSize: 10,
    color: '#00875A',
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  destText: {
    fontSize: 15,
    fontWeight: '900',
    color: Theme.colors.primaryDark,
  },
});
