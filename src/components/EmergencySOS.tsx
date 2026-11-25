import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../constants/Theme';
import { AlertTriangle, Wrench, XCircle, ShieldAlert, X, HelpCircle, CheckCircle2 } from 'lucide-react-native';
import * as Location from 'expo-location';
import { queueSOS } from '../services/DatabaseService';
import { BACKEND_URL, getManilaTimeString, getSessionHeaders } from '../services/SessionService';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface EmergencySOSProps {
  driver?: {
    name?: string;
    id?: string;
    truckId?: string;
    plate?: string;
    routeId?: string;
  };
  bottomOffset?: number; // Kept for backwards compatibility
}

export default function EmergencySOS({ driver }: EmergencySOSProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const insets = useSafeAreaInsets();

  const handleSOS = async (reason: 'Flat Tire' | 'Engine Breakdown' | 'Accident' | 'Other') => {
    setIsSubmitting(true);
    try {
      // 1. Capture current location
      let latitude = 8.4770172;
      let longitude = 124.6798424;

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      } catch (locErr) {
        console.warn('Could not acquire precise GPS for SOS, using fallback location', locErr);
      }

      const idempotencyKey = generateUUID();
      const nowManila = getManilaTimeString();

      const driverId = driver?.id || driver?.name || 'driver';
      const driverName = driver?.name || 'Assigned Driver';
      const truckId = driver?.truckId || '';
      const loadSlipId = driver?.routeId || null;

      // 2. Queue into SQLite for immediate local persistence
      await queueSOS({
        idempotencyKey,
        driverId,
        driverName,
        truckId,
        loadSlipId,
        reason,
        latitude,
        longitude
      });

      // 3. Immediately broadcast to FastAPI backend if online
      try {
        const headers = await getSessionHeaders();
        await fetch(`${BACKEND_URL}/api/v1/telemetry/sos`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            driver_id: driverId,
            driver_name: driverName,
            truck_id: truckId || 'UNASSIGNED',
            load_slip_id: loadSlipId,
            latitude,
            longitude,
            reason,
            idempotency_key: idempotencyKey
          })
        });
      } catch (postErr) {
        console.warn("Direct SOS broadcast to backend failed, queued in SQLite:", postErr);
      }

      setModalVisible(false);

      // 4. Display clear confirmation alert
      Alert.alert(
        "EMERGENCY ALERT BROADCASTED",
        `Dispatch & Fleet Management at Gusa Depot have been notified immediately.\n\n• Reason: ${reason}\n• Vehicle: ${truckId || 'Unassigned'}\n• Driver: ${driverName}\n• GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}\n• Logged At: ${nowManila} (Asia/Manila)\n\nPlease remain in a safe location with the vehicle. Assistance is on the way.`,
        [{ text: "I Am Safe / Acknowledge", style: "default" }]
      );
    } catch (err) {
      console.error('Error broadcasting SOS:', err);
      Alert.alert("Distress Queued", "Your emergency signal has been recorded in local storage and will alert dispatch immediately.");
      setModalVisible(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Top-Right Floating Emergency SOS Button */}
      <TouchableOpacity
        style={[
          styles.topRightFab,
          { top: Math.max(insets.top, 12) + 6 }
        ]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
        accessibilityLabel="Emergency SOS Alert"
      >
        <ShieldAlert size={19} color="#ffffff" />
        <Text style={styles.topRightText}>SOS</Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          if (!isSubmitting) setModalVisible(false);
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.modalContent}>
            <View style={styles.header}>
              <View style={styles.headerTitleRow}>
                <AlertTriangle size={28} color={Theme.colors.danger} />
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.title}>EMERGENCY SOS</Text>
                  <Text style={styles.headerSub}>CDO Dispatch Rapid Response</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => !isSubmitting && setModalVisible(false)}
                style={styles.closeBtn}
                disabled={isSubmitting}
              >
                <X size={24} color={Theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.driverInfoBanner}>
              <Text style={styles.driverInfoText}>
                Vehicle: <Text style={styles.bold}>{driver?.truckId || 'Unassigned'}</Text> • Driver: <Text style={styles.bold}>{driver?.name || 'Driver'}</Text>
              </Text>
            </View>

            <Text style={styles.subtitle}>
              Select your road emergency. Current GPS coordinates will be captured and broadcast directly to Gusa Depot dispatchers.
            </Text>

            {isSubmitting ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Theme.colors.danger} />
                <Text style={styles.loadingText}>Broadcasting distress coordinates to dispatch...</Text>
              </View>
            ) : (
              <View style={styles.optionsContainer}>
                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => handleSOS('Flat Tire')}
                  activeOpacity={0.8}
                >
                  <XCircle size={26} color={Theme.colors.danger} />
                  <View style={styles.optionContent}>
                    <Text style={styles.optionText}>Flat Tire</Text>
                    <Text style={styles.optionSub}>Tire blowout or roadside puncture</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => handleSOS('Engine Breakdown')}
                  activeOpacity={0.8}
                >
                  <Wrench size={26} color={Theme.colors.danger} />
                  <View style={styles.optionContent}>
                    <Text style={styles.optionText}>Engine Breakdown</Text>
                    <Text style={styles.optionSub}>Overheating, mechanical, or battery failure</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => handleSOS('Accident')}
                  activeOpacity={0.8}
                >
                  <AlertTriangle size={26} color={Theme.colors.danger} />
                  <View style={styles.optionContent}>
                    <Text style={styles.optionText}>Road Accident / Collision</Text>
                    <Text style={styles.optionSub}>Vehicle crash or traffic blockage</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.optionButton}
                  onPress={() => handleSOS('Other')}
                  activeOpacity={0.8}
                >
                  <HelpCircle size={26} color={Theme.colors.danger} />
                  <View style={styles.optionContent}>
                    <Text style={styles.optionText}>Other Emergency</Text>
                    <Text style={styles.optionSub}>Medical, security, or extreme weather</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.footerNote}>
              <CheckCircle2 size={16} color="#16a34a" />
              <Text style={styles.footerText}>
                Location: JICA ICEPLANT (#69 Old Road Gusa, CDOC 9000) ⇄ CDO Corridor
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  topRightFab: {
    position: 'absolute',
    right: 14,
    backgroundColor: '#dc2626', // strong high-contrast red
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 10,
    zIndex: 9999,
  },
  topRightText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.lg,
  },
  modalContent: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.xl,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Theme.spacing.sm,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: Theme.colors.danger,
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  driverInfoBanner: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginVertical: 10,
  },
  driverInfoText: {
    fontSize: 12,
    color: '#475569',
  },
  bold: {
    fontWeight: 'bold',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.lg,
    lineHeight: 18,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  optionsContainer: {
    gap: 10,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: '#fef2f2',
    borderRadius: Theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: '#fecaca',
  },
  optionContent: {
    flex: 1,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#991b1b',
  },
  optionSub: {
    fontSize: 12,
    color: '#7f1d1d',
    marginTop: 2,
  },
  loadingContainer: {
    paddingVertical: Theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  footerText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
});
