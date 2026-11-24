import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../constants/Theme';
import { RotateCcw, AlertTriangle } from 'lucide-react-native';

interface ErrorFallbackProps {
  error?: Error | string;
  onReset?: () => void;
  title?: string;
  message?: string;
}

export default function ErrorFallback({
  error,
  onReset,
  title = "Something Went Wrong",
  message = "An unexpected error occurred in JICA Mobile. Tap below to reload the screen."
}: ErrorFallbackProps) {
  const errorMessage = typeof error === 'string' ? error : error?.message || message;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/jica-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <View style={styles.badge}>
          <AlertTriangle size={14} color="#DC2626" />
          <Text style={styles.badgeText}>APPLICATION NOTICE</Text>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{errorMessage}</Text>

        {onReset && (
          <TouchableOpacity style={styles.button} onPress={onReset} activeOpacity={0.8}>
            <RotateCcw size={18} color="#FFFFFF" />
            <Text style={styles.buttonText}>Reload Application</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.footerText}>
        JICA Ice Logistics & Delivery • Cagayan de Oro City
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 8,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center'
  },
  logo: {
    width: '100%',
    height: '100%'
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#450A0A',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D'
  },
  badgeText: {
    color: '#F87171',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8
  },
  message: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Theme.colors.primary,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: Theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  footerText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 20
  }
});
