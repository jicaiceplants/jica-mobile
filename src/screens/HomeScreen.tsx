import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  AppState
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../constants/Theme';
import {
  ClipboardList,
  Truck,
  Package,
  ArrowRight,
  Key,
  X,
  CheckCircle,
  Mail,
  RefreshCw,
  AlertCircle,
  LogOut
} from 'lucide-react-native';
import EmergencySOS from '../components/EmergencySOS';
import { getUnsyncedSummary, setSetting } from '../services/DatabaseService';
import { syncDataWithServer } from '../services/SyncService';
import { supabase } from '../services/SupabaseClient';
import {
  BACKEND_URL,
  getManilaDateString,
  getSessionHeaders,
  getStoredDriver,
  validateMobileSession,
  logoutMobileSession,
  subscribeSessionRevoked,
  notifySessionRevoked,
  isUuid,
  SESSION_REVOKED_MESSAGE
} from '../services/SessionService';

export default function HomeScreen({ route, navigation }: any) {
  const [driverState, setDriverState] = useState<any>(
    () =>
      route?.params?.driver || {
        id: "",
        name: "Driver",
        truckId: "",
        plate: "",
        email: ""
      }
  );
  const driver = driverState;
  const revokedHandledRef = useRef(false);

  useEffect(() => {
    if (!driverState?.id) {
      getStoredDriver().then(saved => {
        if (saved) setDriverState(saved);
      });
    }
  }, [driverState?.id]);

  const [isLoading, setIsLoading] = useState(false);
  const [todayLoadSlip, setTodayLoadSlip] = useState<any>(null);

  // Password Change Modal State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Gmail Edit Modal State
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [driverEmail, setDriverEmail] = useState(driver.email || '');
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  const handleSessionKicked = useCallback(
    async (reason: string = SESSION_REVOKED_MESSAGE) => {
      if (revokedHandledRef.current) return;
      revokedHandledRef.current = true;
      await logoutMobileSession(driver);
      Alert.alert("Session Signed Out", reason, [
        {
          text: "OK",
          onPress: () => navigation.replace('Login', { notice: reason })
        }
      ]);
      navigation.replace('Login', { notice: reason });
    },
    [driver, navigation]
  );

  const fetchTodayDispatch = useCallback(async () => {
    if (!driver?.id && !driver?.truckId) return;
    setIsLoading(true);
    try {
      // 1. Fetch latest email if valid UUID
      if (isUuid(driver.id)) {
        const { data: uData } = await supabase
          .from("user_accounts")
          .select("email, assigned_truck_id")
          .eq("id", driver.id)
          .limit(1);
        if (uData && uData.length > 0) {
          if (uData[0].email) setDriverEmail(uData[0].email);
          if (uData[0].assigned_truck_id && uData[0].assigned_truck_id !== driver.truckId) {
            setDriverState((prev: any) => ({ ...prev, truckId: uData[0].assigned_truck_id }));
          }
        }
      }

      const todayStr = getManilaDateString();

      // 2. Try FastAPI backend first (handles Manila date, UUID safety, and priority sorting)
      try {
        const headers = await getSessionHeaders();
        const url = `${BACKEND_URL}/api/v1/driver/active-dispatch?driver_id=${encodeURIComponent(
          driver.id || ""
        )}&truck_id=${encodeURIComponent(driver.truckId || "")}&shift_date=${todayStr}`;
        const res = await fetch(url, { headers });
        if (res.ok) {
          const json = await res.json();
          if (json?.active_dispatch && json.active_dispatch.load_slip_items?.length > 0) {
            setTodayLoadSlip(json.active_dispatch);
            return;
          }
          setTodayLoadSlip(null);
          return;
        }
      } catch {
        // Offline fallback below
      }

      // 3. Direct Supabase fallback (strictly UUID-safe OR filters)
      let query = supabase
        .from("load_slips")
        .select("*, load_slip_items(*, delivery_hubs(*))")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);

      const orParts: string[] = [];
      if (driver.truckId) orParts.push(`truck_id.eq.${driver.truckId}`);
      if (isUuid(driver.id)) orParts.push(`driver_id.eq.${driver.id}`);
      if (orParts.length > 0) {
        query = query.or(orParts.join(","));
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        const activeList = data.filter((s: any) => {
          const st = String(s.status || "").toUpperCase();
          const hasItems = Array.isArray(s.load_slip_items) && s.load_slip_items.length > 0;
          return (
            hasItems &&
            ["DISPATCHED", "ACTIVE", "PENDING", "IN_TRANSIT", "IN-TRANSIT"].includes(st)
          );
        });
        const matchedToday = activeList.find((s: any) => s.date === todayStr) || activeList[0] || null;
        setTodayLoadSlip(matchedToday);
      } else {
        setTodayLoadSlip(null);
      }
    } catch (err) {
      console.warn("Could not fetch today's dispatch summary:", err);
      setTodayLoadSlip(null);
    } finally {
      setIsLoading(false);
    }
  }, [driver.id, driver.truckId]);

  useFocusEffect(
    useCallback(() => {
      fetchTodayDispatch();
      syncDataWithServer().catch(() => { });
    }, [fetchTodayDispatch])
  );

  // Foreground resume refresh
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => {
      if (next === "active") {
        fetchTodayDispatch();
      }
    });
    return () => sub.remove();
  }, [fetchTodayDispatch]);

  // Supabase Realtime for instant new Load Slip notifications & Single-Session Guard
  useEffect(() => {
    const unsubRevoke = subscribeSessionRevoked((reason) => {
      handleSessionKicked(reason);
    });

    const channel = supabase
      .channel(`home-driver-live-${driver.id || "anon"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "load_slips" },
        () => {
          fetchTodayDispatch();
        }
      );

    if (isUuid(driver.id)) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_accounts",
          filter: `id=eq.${driver.id}`
        },
        (payload: any) => {
          const remoteToken = payload?.new?.active_session_token;
          const localToken = driver?.session_token || driver?.active_session_token;
          if (payload?.new?.is_active === false || payload?.new?.deleted_at) {
            notifySessionRevoked("Your account has been deactivated.");
            return;
          }
          if (localToken && remoteToken && remoteToken !== localToken) {
            notifySessionRevoked(SESSION_REVOKED_MESSAGE);
          }
        }
      );
    }

    channel.subscribe();

    const sessionPoll = setInterval(async () => {
      const check = await validateMobileSession(driver.id, driver.session_token);
      if (!check.valid) {
        handleSessionKicked(check.reason || SESSION_REVOKED_MESSAGE);
      }
    }, 8000);

    return () => {
      unsubRevoke();
      clearInterval(sessionPoll);
      supabase.removeChannel(channel);
    };
  }, [driver.id, driver.session_token, fetchTodayDispatch, handleSessionKicked]);

  const dispatchMetrics = useMemo(() => {
    if (!todayLoadSlip || !todayLoadSlip.load_slip_items || todayLoadSlip.load_slip_items.length === 0) {
      return {
        hasDispatch: false,
        routeId: "None Assigned",
        date: new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date()),
        totalSacks: 0,
        stopsCount: 0,
        inventory: [] as Array<{ id: number; type: string; qty: number }>
      };
    }

    const items = todayLoadSlip.load_slip_items;
    const totalSacks = items.reduce((sum: number, it: any) => sum + (it.planned_qty || 0), 0);
    const hubsSet = new Set(items.map((it: any) => it.hub_id || it.delivery_hubs?.id || it.customer_name));

    // Group inventory by product_name
    const invMap = new Map<string, number>();
    items.forEach((it: any) => {
      const typeName = it.product_name || it.ice_type || it.description || "Ice Sacks";
      invMap.set(typeName, (invMap.get(typeName) || 0) + (it.planned_qty || 0));
    });

    const inventory = Array.from(invMap.entries()).map(([type, qty], idx) => ({
      id: idx + 1,
      type,
      qty
    }));

    return {
      hasDispatch: true,
      routeId: todayLoadSlip.slip_number || `LS-${todayLoadSlip.id.slice(0, 8)}`,
      date: todayLoadSlip.date,
      totalSacks,
      stopsCount: hubsSet.size,
      inventory
    };
  }, [todayLoadSlip]);

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError("Please enter your current password or PIN.");
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      setPasswordError("New password must be at least 4 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    try {
      const headers = await getSessionHeaders();
      const res = await fetch(`${BACKEND_URL}/api/v1/auth/change-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: driver.id,
          old_password: currentPassword,
          new_password: newPassword
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPasswordError(json.detail || "Current password incorrect or unable to update.");
        return;
      }

      await setSetting(`driver_pass_${driver.truckId}`, newPassword);
      setPasswordSuccess("Password updated across JICA system!");
      setTimeout(() => {
        setIsPasswordModalOpen(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordSuccess('');
      }, 1500);
    } catch (e: any) {
      setPasswordError("Network error updating password. Try again when online.");
    }
  };

  const handleLogoutPress = async () => {
    const summary = await getUnsyncedSummary();
    const hasPending = summary.totalPending > 0 || summary.gpsCount > 0;
    const msg = hasPending
      ? `You have ${summary.txCount} unsynced delivery drop(s) and ${summary.gpsCount} GPS log(s). We will attempt to sync before signing out.`
      : `Sign out of ${driver.name || "Driver"} (${driver.truckId || "Fleet"}) on this phone?`;

    Alert.alert(hasPending ? "Sync & Sign Out?" : "Sign Out", msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: hasPending ? "Sync & Sign Out" : "Sign Out",
        style: "destructive",
        onPress: async () => {
          if (hasPending) {
            await syncDataWithServer(todayLoadSlip?.id).catch(() => { });
          }
          await logoutMobileSession(driver);
          navigation.replace('Login');
        }
      }
    ]);
  };

  const handleSaveEmail = async () => {
    setEmailError('');
    setEmailSuccess('');

    const clean = emailInput.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setEmailError("Please enter a valid Gmail address.");
      return;
    }

    setIsSavingEmail(true);
    try {
      const { error } = await supabase
        .from("user_accounts")
        .update({ email: clean })
        .eq("id", driver.id);

      if (error) {
        setEmailError("Failed to save email. Please try again.");
      } else {
        setDriverEmail(clean);
        setEmailSuccess("Gmail address updated successfully!");
        setTimeout(() => {
          setIsEmailModalOpen(false);
          setEmailSuccess('');
        }, 1500);
      }
    } catch (err) {
      setEmailError("Network error saving email.");
    } finally {
      setIsSavingEmail(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header Floating Emergency SOS */}
      <EmergencySOS driver={{ ...driver, routeId: todayLoadSlip?.id }} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchTodayDispatch}
            colors={[Theme.colors.primary]}
          />
        }
      >

        {/* Header Card */}
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Image
              source={require('../../assets/JICA Ice Logistics Logo.png')}
              style={styles.headerLogo}
              resizeMode="contain"
            />
            <View style={styles.truckBadge}>
              <Truck size={15} color={Theme.colors.primaryDark} />
              <Text style={styles.truckText}>{driver.truckId}</Text>
            </View>
          </View>

          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: 40 }}>
              <Text style={styles.greeting}>Good Day, Driver</Text>
              <Text style={styles.driverName}>{driver.name}</Text>
              <Text style={styles.truckSubText}>Vehicle: {driver.truckId} • {driver.plate}</Text>

              {/* Driver Gmail Status */}
              <View style={styles.emailBadgeRow}>
                <Mail size={13} color="#93c5fd" />
                <Text style={styles.emailBadgeText}>
                  {driverEmail ? driverEmail : "No Gmail registered"}
                </Text>
              </View>
            </View>
          </View>

          {/* Action Pills for Driver */}
          <View style={styles.headerBottomActionRow}>
            <TouchableOpacity
              style={styles.actionPill}
              onPress={() => {
                setPasswordError('');
                setPasswordSuccess('');
                setIsPasswordModalOpen(true);
              }}
              activeOpacity={0.8}
            >
              <Key size={13} color="#ffffff" />
              <Text style={styles.actionPillText}>Change Password</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionPill, styles.actionPillSecondary]}
              onPress={() => {
                setEmailInput(driverEmail);
                setEmailError('');
                setEmailSuccess('');
                setIsEmailModalOpen(true);
              }}
              activeOpacity={0.8}
            >
              <Mail size={13} color="#ffffff" />
              <Text style={styles.actionPillText}>Edit Gmail</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionPill,
                {
                  backgroundColor: 'rgba(239, 68, 68, 0.25)',
                  borderColor: 'rgba(252, 165, 165, 0.5)',
                  borderWidth: 1
                }
              ]}
              onPress={handleLogoutPress}
              activeOpacity={0.8}
            >
              <LogOut size={13} color="#ffffff" />
              <Text style={styles.actionPillText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Daily Route Summary */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <ClipboardList size={22} color={Theme.colors.primary} />
              <Text style={styles.sectionTitle}>Today&apos;s Dispatch Summary</Text>
            </View>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={fetchTodayDispatch}
              disabled={isLoading}
            >
              <RefreshCw size={17} color={Theme.colors.primary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subText}>
            E-Load Slip: {dispatchMetrics.routeId} • {dispatchMetrics.date}
          </Text>

          {/* Sacks on Truck Banner */}
          <View style={styles.metricBanner}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{dispatchMetrics.totalSacks}</Text>
              <Text style={styles.metricLabel}>Total Sacks Loaded</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{dispatchMetrics.stopsCount}</Text>
              <Text style={styles.metricLabel}>CDO Delivery Hubs</Text>
            </View>
          </View>

          {/* If Dispatch is Active: Show Inventory Card */}
          {dispatchMetrics.hasDispatch ? (
            <View style={styles.inventoryCard}>
              {dispatchMetrics.inventory.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.inventoryRow,
                    index < dispatchMetrics.inventory.length - 1 && styles.borderBottom
                  ]}
                >
                  <View style={styles.inventoryType}>
                    <Package size={20} color={Theme.colors.textSecondary} />
                    <Text style={styles.inventoryName}>{item.type}</Text>
                  </View>
                  <Text style={styles.inventoryQty}>{item.qty} sacks</Text>
                </View>
              ))}
            </View>
          ) : (
            /* High-Contrast Empty State if No Route Assigned Today */
            <View style={styles.emptyNoticeCard}>
              <View style={styles.emptyNoticeIconWrap}>
                <AlertCircle size={28} color="#d97706" />
              </View>
              <Text style={styles.emptyNoticeTitle}>No Dispatch Assigned Today</Text>
              <Text style={styles.emptyNoticeText}>
                You do not have an active Load Slip scheduled yet. Tap Refresh or wait for JICA Office Dispatch to assign your truck route.
              </Text>
              <TouchableOpacity
                style={styles.emptyRefreshBtn}
                onPress={fetchTodayDispatch}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <RefreshCw size={15} color="#ffffff" />
                    <Text style={styles.emptyRefreshBtnText}>Refresh Dispatch</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Start Route Action Button */}
        <TouchableOpacity
          style={[styles.actionButton, !dispatchMetrics.hasDispatch && styles.actionButtonDisabled]}
          onPress={() => navigation.navigate('ActiveRoute', { driver })}
          activeOpacity={0.85}
        >
          <Text style={styles.actionButtonText}>
            {dispatchMetrics.hasDispatch ? "Start Active Delivery Route" : "Open Delivery Map & Stops"}
          </Text>
          <ArrowRight size={22} color={Theme.colors.primaryDark} />
        </TouchableOpacity>

      </ScrollView>

      {/* Driver Change Password Modal */}
      <Modal
        visible={isPasswordModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsPasswordModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Key size={22} color={Theme.colors.primary} />
                <Text style={styles.modalTitle}>Change Driver Password</Text>
              </View>
              <TouchableOpacity onPress={() => setIsPasswordModalOpen(false)}>
                <X size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Update your mobile password for vehicle account ({driver.truckId}).
            </Text>

            {passwordError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{passwordError}</Text>
              </View>
            ) : null}

            {passwordSuccess ? (
              <View style={styles.successBox}>
                <CheckCircle size={16} color="#16a34a" />
                <Text style={styles.successText}>{passwordSuccess}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Current Password</Text>
              <TextInput
                secureTextEntry
                placeholder="Enter current password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>New Password (min 4 characters)</Text>
              <TextInput
                secureTextEntry
                placeholder="Enter new password"
                value={newPassword}
                onChangeText={setNewPassword}
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm New Password</Text>
              <TextInput
                secureTextEntry
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                style={styles.input}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsPasswordModalOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleChangePassword}
              >
                <Text style={styles.saveBtnText}>Save Password</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Driver Gmail Address Edit Modal */}
      <Modal
        visible={isEmailModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsEmailModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Mail size={22} color={Theme.colors.primary} />
                <Text style={styles.modalTitle}>Update Driver Gmail</Text>
              </View>
              <TouchableOpacity onPress={() => setIsEmailModalOpen(false)}>
                <X size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Your Gmail address is used to receive 6-digit verification codes whenever you reset your password.
            </Text>

            {emailError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{emailError}</Text>
              </View>
            ) : null}

            {emailSuccess ? (
              <View style={styles.successBox}>
                <CheckCircle size={16} color="#16a34a" />
                <Text style={styles.successText}>{emailSuccess}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Gmail Address</Text>
              <TextInput
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="your.name@gmail.com"
                value={emailInput}
                onChangeText={setEmailInput}
                style={styles.input}
              />
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsEmailModalOpen(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                disabled={isSavingEmail}
                onPress={handleSaveEmail}
              >
                <Text style={styles.saveBtnText}>
                  {isSavingEmail ? "Saving..." : "Save Gmail"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContent: {
    padding: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
  },
  headerCard: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.xl,
    marginBottom: Theme.spacing.lg,
    shadowColor: Theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  headerLogo: {
    width: 140,
    height: 48,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  truckBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Theme.colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Theme.borderRadius.full,
  },
  truckText: {
    color: Theme.colors.primaryDark,
    fontWeight: '900',
    fontSize: 13,
  },
  greeting: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  driverName: {
    color: Theme.colors.surface,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
  },
  truckSubText: {
    color: '#e2e8f0',
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
  },
  emailBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  emailBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  headerBottomActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  actionPillSecondary: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  actionPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  section: {
    marginBottom: Theme.spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  refreshIconBtn: {
    padding: 6,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Theme.colors.text,
  },
  subText: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.md,
  },
  metricBanner: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: Theme.spacing.md,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 26,
    fontWeight: '900',
    color: Theme.colors.primary,
  },
  metricLabel: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  metricDivider: {
    width: 1,
    backgroundColor: Theme.colors.border,
  },
  inventoryCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  inventoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  inventoryType: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  inventoryName: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text,
  },
  inventoryQty: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.primary,
  },
  emptyNoticeCard: {
    backgroundColor: '#ffffff',
    borderRadius: Theme.borderRadius.xl,
    padding: 24,
    borderWidth: 2,
    borderColor: '#fde68a',
    alignItems: 'center',
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  emptyNoticeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyNoticeTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#92400e',
    textAlign: 'center',
  },
  emptyNoticeText: {
    fontSize: 13,
    color: '#78350f',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 16,
    maxWidth: 290,
  },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#00875A',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: '#00875A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyRefreshBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  actionButton: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.accent,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    shadowColor: Theme.colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  actionButtonDisabled: {
    opacity: 0.9,
    backgroundColor: '#cbd5e1',
  },
  actionButtonText: {
    color: Theme.colors.primaryDark,
    fontSize: 16,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 14,
    lineHeight: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#334155',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 'bold',
  },
  successBox: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  successText: {
    color: '#15803d',
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#475569',
  },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#00875A',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});
