import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Theme } from './src/constants/Theme';
import { StatusBar } from 'expo-status-bar';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ActiveRouteScreen from './src/screens/ActiveRouteScreen';
import MapScreen from './src/screens/MapScreen';

// Services
import { initDatabase } from './src/services/DatabaseService';
import { startLocationTracking, stopLocationTracking } from './src/services/LocationService';
import { startNetworkListener } from './src/services/SyncService';

import { SafeAreaProvider } from 'react-native-safe-area-context';

const Stack = createNativeStackNavigator();

export default function App() {
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    let unsubscribeNetwork: (() => void) | null = null;

    const setupApp = async () => {
      try {
        // 1. Initialize SQLite Database
        await initDatabase();
        
        // 2. Start GPS Tracking (Foreground watch with 15m filter)
        await startLocationTracking();

        // 3. Start Network Listener for Store-and-Forward
        unsubscribeNetwork = startNetworkListener();

        // Smooth transition duration for branded initial loading view
        await new Promise(resolve => setTimeout(resolve, 600));
      } catch (err) {
        console.error('App initialization error:', err);
      } finally {
        setIsAppReady(true);
      }
    };

    setupApp();

    return () => {
      stopLocationTracking();
      if (unsubscribeNetwork) unsubscribeNetwork();
    };
  }, []);

  if (!isAppReady) {
    return (
      <View style={styles.splashContainer}>
        <StatusBar style="dark" />
        <View style={styles.splashCard}>
          <Image 
            source={require('./assets/JICA Ice Logistics Logo.png')} 
            style={styles.splashLogo} 
            resizeMode="contain" 
          />
          <Text style={styles.splashTitle}>IceTrack</Text>
          <Text style={styles.splashSubtitle}>
            J.I.C.A ICE LOGISTICS & DELIVERY • CDO
          </Text>
          <View style={styles.loadingWrapper}>
            <ActivityIndicator size="large" color="#00875A" />
            <Text style={styles.loadingText}>Initializing local storage & route manifest...</Text>
          </View>
        </View>
        <Text style={styles.splashFooter}>
          Gusa Depot, Cagayan de Oro City • RA 10173 Compliant
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{
            headerShown: false,
            headerStyle: {
              backgroundColor: Theme.colors.primary,
            },
            headerTintColor: Theme.colors.surface,
            headerTitleStyle: {
              fontWeight: 'bold',
            },
            headerTitleAlign: 'center',
          }}
        >
          <Stack.Screen 
            name="Login" 
            component={LoginScreen} 
          />
          <Stack.Screen 
            name="Main" 
            component={HomeScreen} 
          />
          <Stack.Screen 
            name="ActiveRoute" 
            component={ActiveRouteScreen} 
          />
          <Stack.Screen
            name="Map"
            component={MapScreen}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#F1F5F9', // Clean light background
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  splashCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    width: '100%',
  },
  splashLogo: {
    width: 170,
    height: 170,
    marginBottom: 16,
  },
  splashTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: '#00875A',
    letterSpacing: 1,
  },
  splashSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1.5,
    marginTop: 4,
    textAlign: 'center',
  },
  loadingWrapper: {
    marginTop: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  splashFooter: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
  },
});
