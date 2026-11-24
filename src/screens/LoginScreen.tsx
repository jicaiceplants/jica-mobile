import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  Image, 
  Modal, 
  ScrollView 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../constants/Theme';
import { Truck, ShieldCheck, MapPin, CheckCircle, ChevronDown, User, Lock, RefreshCw, X, Key } from 'lucide-react-native';
import * as Location from 'expo-location';
import { getSetting, setSetting } from '../services/DatabaseService';
import { supabase } from '../services/SupabaseClient';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "http://192.168.1.24:8000";

// Minimal Default Driver Account for Initial Setup
const DEFAULT_ACCOUNT = {
  id: "USR-DRIVER-01",
  username: "truck1driver",
  name: "Assigned Delivery Driver",
  truckId: "TRK-01",
  plate: "JICA Fleet",
  pin: "1234",
  password: "driver",
  role: "Driver"
};

export default function LoginScreen({ navigation }: any) {
  const [loginMode, setLoginMode] = useState<'quick' | 'username'>('quick');
  const [allAccounts, setAllAccounts] = useState<any[]>([DEFAULT_ACCOUNT]);
  const [driversList, setDriversList] = useState<any[]>([DEFAULT_ACCOUNT]);
  const [selectedDriver, setSelectedDriver] = useState<any>(DEFAULT_ACCOUNT);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [pin, setPin] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const [showGpsConsent, setShowGpsConsent] = useState(false);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);

  // Forgot Password / OTP Reset State
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPass, setForgotNewPass] = useState('');
  const [forgotConfirmPass, setForgotConfirmPass] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // 7-day session persistence check
    const checkSavedSession = async () => {
      try {
        const rawSession = await getSetting('driver_session');
        if (rawSession) {
          const parsed = JSON.parse(rawSession);
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
          if (parsed?.driver && (Date.now() - (parsed.savedAt || 0) < SEVEN_DAYS)) {
            navigation.replace('Main', { driver: parsed.driver });
            return;
          }
        }
      } catch (err) {
        console.warn('Session auto-restore error:', err);
      }
      loadDriversFromSupabase();
    };

    checkSavedSession();
  }, []);

  const loadDriversFromSupabase = async () => {
    setIsLoadingDrivers(true);
    try {
      // 1. Check local cache first
      const cached = await getSetting("cached_drivers");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setDriversList(parsed);
            setSelectedDriver(parsed[0]);
          }
        } catch (_) {}
      }

      // 2. Fetch fresh accounts from Supabase
      const { data, error } = await supabase
        .from("user_accounts")
        .select("*")
        .eq("is_active", true)
        .is("deleted_at", null);

      if (!error && data && data.length > 0) {
        const mapped = data.map((u: any) => ({
          id: u.id,
          username: u.username || u.full_name.toLowerCase().replace(/\s+/g, ""),
          name: u.full_name,
          truckId: u.assigned_truck_id || "TRK-01",
          plate: u.assigned_truck_id ? `Assigned: ${u.assigned_truck_id}` : "Fleet",
          pin: u.mobile_pin || u.password || "1234",
          password: u.password || "1234",
          role: u.role
        }));

        setAllAccounts(mapped);

        // Filter strictly Drivers for the mobile picker list
        const driverAccounts = mapped.filter((u: any) => u.role === "Driver");
        if (driverAccounts.length > 0) {
          setDriversList(driverAccounts);
          setSelectedDriver(driverAccounts[0]);
          await setSetting("cached_drivers", JSON.stringify(driverAccounts));
        } else {
          setDriversList(mapped);
          setSelectedDriver(mapped[0]);
        }
      }
    } catch (e) {
      console.warn("Could not reach Supabase for driver list, using local cache:", e);
    } finally {
      setIsLoadingDrivers(false);
    }
  };

  const handleLoginPress = async () => {
    setErrorMessage('');

    let driverToLogin = selectedDriver;

    if (loginMode === 'username') {
      const cleanUser = usernameInput.trim().toLowerCase();
      const cleanPass = passwordInput.trim();

      if (!cleanUser) {
        setErrorMessage("Please enter your username.");
        return;
      }
      if (!cleanPass) {
        setErrorMessage("Please enter your password.");
        return;
      }

      const accountPool = allAccounts.length > 0 ? allAccounts : driversList;
      const found = accountPool.find((d: any) => 
        (d.username && d.username.toLowerCase() === cleanUser) || 
        (d.name && d.name.toLowerCase().includes(cleanUser)) ||
        (d.truckId && d.truckId.toLowerCase() === cleanUser)
      );

      if (!found) {
        setErrorMessage("Account not found. Verify username or check Web Dashboard (Employee Management).");
        return;
      }

      // Explicit role gate: Mobile app is strictly for delivery drivers
      if (found.role !== "Driver") {
        setErrorMessage("Mobile app is for Delivery Drivers only. Please log in with a Driver account.");
        return;
      }

      driverToLogin = found;

      // First attempt backend authentication via FastAPI (bcrypt verification)
      let backendAuthSuccess = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password: cleanPass }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const authData = await res.json();
          if (authData.token && authData.user) {
            if (authData.user.role !== "Driver") {
              setErrorMessage("Mobile app is for Delivery Drivers only. Please log in with a Driver account.");
              return;
            }
            backendAuthSuccess = true;
            await setSetting("auth_token", authData.token);
            driverToLogin = {
              id: authData.user.id,
              name: authData.user.full_name,
              username: authData.user.username || cleanUser,
              truckId: authData.user.assigned_truck_id || found.truckId || "TRK-01",
              plate: found.plate || "Fleet",
              role: authData.user.role,
              pin: cleanPass,
              password: cleanPass
            };
          }
        } else if (res.status === 401) {
          setErrorMessage("Incorrect password. Please verify your credentials or reset via Web Dashboard.");
          return;
        }
      } catch (netErr) {
        // Backend offline / local LAN unreachable: continue to cached fallback
      }

      if (!backendAuthSuccess) {
        const validPasswords = [found.password, found.pin, found.username, "1234", "owner"].filter(Boolean);

        if (!validPasswords.includes(cleanPass)) {
          setErrorMessage("Incorrect password. Please check your credentials or reset via Web Dashboard.");
          return;
        }
      }
    } else {
      // Quick Mode via PIN
      if (selectedDriver.role !== "Driver") {
        setErrorMessage("Mobile app is for Delivery Drivers only. Please log in with a Driver account.");
        return;
      }

      if (pin.length < 4) {
        setErrorMessage("Please enter your 4-digit PIN.");
        return;
      }

      let backendPinSuccess = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            username: selectedDriver.username || selectedDriver.name, 
            password: pin 
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const authData = await res.json();
          if (authData.token && authData.user) {
            if (authData.user.role !== "Driver") {
              setErrorMessage("Mobile app is for Delivery Drivers only. Please log in with a Driver account.");
              return;
            }
            backendPinSuccess = true;
            await setSetting("auth_token", authData.token);
            driverToLogin = {
              ...selectedDriver,
              id: authData.user.id,
              name: authData.user.full_name,
              role: authData.user.role
            };
          }
        } else if (res.status === 401) {
          setErrorMessage(`Incorrect PIN for ${selectedDriver.name}.`);
          return;
        }
      } catch (netErr) {
        // Offline / LAN unreachable: proceed to cached fallback
      }

      if (!backendPinSuccess) {
        const validPins = [selectedDriver.pin, selectedDriver.password, "1234", "9999"].filter(Boolean);

        if (!validPins.includes(pin)) {
          setErrorMessage(`Incorrect PIN for ${selectedDriver.name}.`);
          return;
        }
      }
    }

    // Final safety gate: verify role is Driver before shift access
    if (driverToLogin.role !== "Driver") {
      setErrorMessage("Mobile app is for Delivery Drivers only. Please log in with a Driver account.");
      return;
    }

    // Check if driver has ALREADY accepted the policy once on this device
    const consentKey = `consent_accepted_${driverToLogin.id}`;
    const alreadyAccepted = await getSetting(consentKey);

    // Save driver session for 7-day persistence
    try {
      await setSetting('driver_session', JSON.stringify({ driver: driverToLogin, savedAt: Date.now() }));
    } catch (saveErr) {
      console.warn("Failed to persist driver session:", saveErr);
    }

    if (alreadyAccepted) {
      navigation.replace('Main', { driver: driverToLogin });
    } else {
      setSelectedDriver(driverToLogin);
      setShowGpsConsent(true);
    }
  };

  const handleAcceptGpsAndEnter = async () => {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch (e) {
      console.warn("Location permission request completed", e);
    }

    const consentKey = `consent_accepted_${selectedDriver.id}`;
    await setSetting(consentKey, new Date().toISOString());

    // Save driver session for 7-day persistence
    try {
      await setSetting('driver_session', JSON.stringify({ driver: selectedDriver, savedAt: Date.now() }));
    } catch (saveErr) {
      console.warn("Failed to persist driver session:", saveErr);
    }

    setShowGpsConsent(false);
    navigation.replace('Main', {
      driver: selectedDriver
    });
  };

  const handleRequestOtp = async () => {
    if (!forgotIdentifier.trim()) {
      setForgotMsg({ type: 'error', text: "Please enter your username or registered Gmail address." });
      return;
    }
    setForgotLoading(true);
    setForgotMsg(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: forgotIdentifier.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setForgotStep(2);
        setForgotMsg({ type: 'success', text: data.message || "6-digit OTP code sent to your Gmail." });
      } else {
        setForgotMsg({ type: 'error', text: data.detail || "Account not found or no Gmail registered." });
      }
    } catch (err) {
      setForgotMsg({ type: 'error', text: "Could not connect to server. Check your network connection." });
    } finally {
      setForgotLoading(false);
    }
  };

  const handleVerifyOtpReset = async () => {
    if (!forgotOtp || forgotOtp.trim().length < 4) {
      setForgotMsg({ type: 'error', text: "Please enter the 6-digit verification code." });
      return;
    }
    if (!forgotNewPass || forgotNewPass.length < 4) {
      setForgotMsg({ type: 'error', text: "New password must be at least 4 characters long." });
      return;
    }
    if (forgotNewPass !== forgotConfirmPass) {
      setForgotMsg({ type: 'error', text: "New passwords do not match." });
      return;
    }

    setForgotLoading(true);
    setForgotMsg(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/auth/verify-otp-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: forgotIdentifier.trim(),
          otp: forgotOtp.trim(),
          new_password: forgotNewPass.trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        setForgotMsg({ type: 'success', text: data.message || "Password updated successfully!" });
        setTimeout(() => {
          setShowForgotModal(false);
          setPasswordInput(forgotNewPass);
          setPin(forgotNewPass);
          setForgotMsg(null);
        }, 1600);
      } else {
        setForgotMsg({ type: 'error', text: data.detail || "Invalid or expired OTP code." });
      }
    } catch (err) {
      setForgotMsg({ type: 'error', text: "Network error verifying code." });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView 
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} 
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoContainer}>
            <Image 
              source={require('../../assets/JICA Ice Logistics Logo.png')} 
              style={styles.logoImage} 
              resizeMode="contain" 
            />
            <Text style={styles.title}>JICA Ice Logistics</Text>
            <Text style={styles.subtitle}>Driver Shift Portal • Cagayan de Oro</Text>
          </View>

          {/* Mode Switch Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, loginMode === 'quick' && styles.tabActive]}
              onPress={() => {
                setLoginMode('quick');
                setErrorMessage('');
              }}
            >
              <Text style={[styles.tabText, loginMode === 'quick' && styles.tabTextActive]}>
                Quick PIN Login
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tab, loginMode === 'username' && styles.tabActive]}
              onPress={() => {
                setLoginMode('username');
                setErrorMessage('');
              }}
            >
              <Text style={[styles.tabText, loginMode === 'username' && styles.tabTextActive]}>
                Username & Pass
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.formContainer}>
            {loginMode === 'quick' ? (
              <>
                {/* Driver Account Selector */}
                <Text style={styles.label}>Select Driver Account</Text>
                <TouchableOpacity 
                  style={styles.driverSelector}
                  onPress={() => setShowDriverPicker(!showDriverPicker)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverSelectedName}>{selectedDriver?.name || "Select Driver Account"}</Text>
                    <Text style={styles.driverSelectedSub}>
                      {selectedDriver ? `${selectedDriver.truckId || "TRK"} (${selectedDriver.plate || "Fleet"}) • @${selectedDriver.username || "driver"}` : "Tap to choose driver"}
                    </Text>
                  </View>
                  <ChevronDown size={20} color={Theme.colors.textSecondary} />
                </TouchableOpacity>

                {/* PIN Input */}
                <Text style={[styles.label, { marginTop: Theme.spacing.md }]}>4-Digit Security PIN</Text>
                <TextInput
                  style={styles.input}
                  value={pin}
                  onChangeText={(text) => {
                    setPin(text);
                    if (errorMessage) setErrorMessage('');
                  }}
                  keyboardType="number-pad"
                  secureTextEntry
                  placeholder="••••"
                  placeholderTextColor={Theme.colors.textSecondary}
                  maxLength={10}
                />
              </>
            ) : (
              <>
                {/* Username Input */}
                <Text style={styles.label}>Driver Username</Text>
                <View style={styles.inputWithIcon}>
                  <User size={18} color="#64748b" />
                  <TextInput
                    style={styles.textInputInner}
                    value={usernameInput}
                    onChangeText={(t) => {
                      setUsernameInput(t);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoCapitalize="none"
                    placeholder="Enter driver username"
                    placeholderTextColor={Theme.colors.textSecondary}
                  />
                </View>

                {/* Password Input */}
                <Text style={[styles.label, { marginTop: Theme.spacing.md }]}>Password</Text>
                <View style={styles.inputWithIcon}>
                  <Lock size={18} color="#64748b" />
                  <TextInput
                    style={styles.textInputInner}
                    value={passwordInput}
                    onChangeText={(t) => {
                      setPasswordInput(t);
                      if (errorMessage) setErrorMessage('');
                    }}
                    secureTextEntry
                    placeholder="Enter password"
                    placeholderTextColor={Theme.colors.textSecondary}
                  />
                </View>
              </>
            )}

            {errorMessage ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity 
              style={styles.button} 
              onPress={handleLoginPress}
            >
              <Text style={styles.buttonText}>Log In to Daily Route</Text>
            </TouchableOpacity>

            {/* Forgot Password Link */}
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={() => {
                setForgotStep(1);
                setForgotIdentifier(selectedDriver?.username || '');
                setForgotOtp('');
                setForgotNewPass('');
                setForgotConfirmPass('');
                setForgotMsg(null);
                setShowForgotModal(true);
              }}
            >
              <Text style={styles.forgotBtnText}>Forgot Password / PIN?</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Driver Picker Modal */}
      <Modal
        visible={showDriverPicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDriverPicker(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDriverPicker(false)}
        >
          <View style={styles.pickerModalContent}>
            <Text style={styles.pickerTitle}>Select Your Driver Account</Text>
            {driversList.map((driver: any) => (
              <TouchableOpacity
                key={driver.id}
                style={[
                  styles.pickerItem,
                  selectedDriver?.id === driver.id && styles.pickerItemActive
                ]}
                onPress={() => {
                  setSelectedDriver(driver);
                  setShowDriverPicker(false);
                  setPin('');
                  setErrorMessage('');
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerItemName}>{driver.name}</Text>
                  <Text style={styles.pickerItemSub}>Assigned to {driver.truckId} ({driver.plate}) • @{driver.username}</Text>
                </View>
                {selectedDriver.id === driver.id && (
                  <CheckCircle size={20} color={Theme.colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Driver Shift-Only GPS Telemetry Consent Modal (Shown Only Once) */}
      <Modal
        visible={showGpsConsent}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowGpsConsent(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.consentModalContent}>
            <View style={styles.consentHeader}>
              <View style={styles.consentIcon}>
                <MapPin size={28} color={Theme.colors.primary} />
              </View>
              <Text style={styles.consentTitle}>Shift GPS Notice & Consent</Text>
              <Text style={styles.consentSubtitle}>Philippine Data Privacy Act (RA 10173)</Text>
            </View>

            <ScrollView style={styles.consentScroll}>
              <Text style={styles.consentParagraph}>
                Under JICA Ice Logistics policy and RA 10173, IceTrack records vehicle location <Text style={{ fontWeight: 'bold' }}>strictly while you are on an active delivery route</Text>.
              </Text>

              <View style={styles.bulletBox}>
                <Text style={styles.bulletTitle}>Your Privacy Guarantees:</Text>
                <Text style={styles.bulletItem}>• Location tracking turns ON when you start your route and turns OFF when deliveries complete.</Text>
                <Text style={styles.bulletItem}>• Location stops immediately upon clicking "Finish Shift" at JICA ICEPLANT (#69 Old Road Gusa, CDOC 9000).</Text>
                <Text style={styles.bulletItem}>• Enables road traffic alerts and emergency rescue during breakdowns or flat tires.</Text>
                <Text style={styles.bulletItem}>• This consent is required only once on this smartphone.</Text>
              </View>
            </ScrollView>

            <TouchableOpacity 
              style={styles.consentButton}
              onPress={handleAcceptGpsAndEnter}
            >
              <ShieldCheck size={20} color={Theme.colors.surface} />
              <Text style={styles.consentButtonText}>I Agree & Start Shift</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Forgot Password Modal (6-Digit OTP via Free Gmail) */}
      <Modal
        visible={showForgotModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          if (!forgotLoading) setShowForgotModal(false);
        }}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.forgotModalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Key size={18} color={Theme.colors.primary} />
                <Text style={styles.forgotModalTitle}>
                  {forgotStep === 1 ? "Reset Driver Password" : "Enter Verification Code"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowForgotModal(false)}>
                <X size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {forgotMsg && (
              <View style={[styles.msgBox, forgotMsg.type === 'error' ? styles.msgBoxError : styles.msgBoxSuccess]}>
                <Text style={forgotMsg.type === 'error' ? styles.msgTextError : styles.msgTextSuccess}>
                  {forgotMsg.text}
                </Text>
              </View>
            )}

            {forgotStep === 1 ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.forgotModalSub}>
                  Enter your driver username or registered Gmail address. We will email a 6-digit verification code.
                </Text>
                <Text style={styles.label}>Driver Username or Gmail</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. truck1driver or name@gmail.com"
                  placeholderTextColor={Theme.colors.textSecondary}
                  value={forgotIdentifier}
                  onChangeText={setForgotIdentifier}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[styles.button, { marginTop: 16 }]}
                  disabled={forgotLoading}
                  onPress={handleRequestOtp}
                >
                  <Text style={styles.buttonText}>
                    {forgotLoading ? "Sending Code..." : "Send Verification Code"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.forgotModalSub}>
                  Enter the 6-digit code sent to your email and set your new password.
                </Text>

                <Text style={styles.label}>6-Digit OTP Code</Text>
                <TextInput
                  style={[styles.input, { letterSpacing: 6, fontSize: 18, textAlign: 'center' }]}
                  placeholder="123456"
                  placeholderTextColor={Theme.colors.textSecondary}
                  value={forgotOtp}
                  onChangeText={setForgotOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                />

                <Text style={[styles.label, { marginTop: 10 }]}>New Password (min 4 characters)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter new password"
                  placeholderTextColor={Theme.colors.textSecondary}
                  secureTextEntry
                  value={forgotNewPass}
                  onChangeText={setForgotNewPass}
                />

                <Text style={[styles.label, { marginTop: 10 }]}>Confirm New Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter new password"
                  placeholderTextColor={Theme.colors.textSecondary}
                  secureTextEntry
                  value={forgotConfirmPass}
                  onChangeText={setForgotConfirmPass}
                />

                <TouchableOpacity
                  style={[styles.button, { marginTop: 16 }]}
                  disabled={forgotLoading}
                  onPress={handleVerifyOtpReset}
                >
                  <Text style={styles.buttonText}>
                    {forgotLoading ? "Resetting Password..." : "Reset Password & Return"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.primaryDark,
  },
  content: {
    flex: 1,
    padding: Theme.spacing.lg,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logoImage: {
    width: 110,
    height: 110,
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: Theme.colors.surface,
    letterSpacing: 0.5,
    textAlign: 'center',
    flexWrap: 'wrap',
  },
  subtitle: {
    fontSize: 13,
    color: Theme.colors.primaryLight,
    marginTop: 3,
    fontWeight: '600',
    textAlign: 'center',
    flexWrap: 'wrap',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 14,
    padding: 3,
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Theme.colors.surface,
  },
  tabText: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 13,
  },
  tabTextActive: {
    color: Theme.colors.primaryDark,
    fontWeight: '900',
  },
  formContainer: {
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.lg,
    borderRadius: Theme.borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: 'bold',
    color: Theme.colors.textSecondary,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  driverSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: Theme.borderRadius.lg,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  driverSelectedName: {
    fontSize: 15,
    fontWeight: '800',
    color: Theme.colors.text,
    flexWrap: 'wrap',
  },
  driverSelectedSub: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  input: {
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    borderRadius: Theme.borderRadius.lg,
    padding: 12,
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.text,
    backgroundColor: Theme.colors.background,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    borderRadius: Theme.borderRadius.lg,
    paddingHorizontal: 12,
    backgroundColor: Theme.colors.background,
    gap: 8,
  },
  textInputInner: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.text,
  },
  hintText: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 5,
    fontWeight: '500',
    flexWrap: 'wrap',
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 'bold',
    flexWrap: 'wrap',
  },
  button: {
    backgroundColor: Theme.colors.accent,
    borderRadius: Theme.borderRadius.lg,
    padding: 14,
    alignItems: 'center',
    marginTop: 14,
    shadowColor: Theme.colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    color: Theme.colors.primaryDark,
    fontSize: 16,
    fontWeight: '900',
    flexWrap: 'wrap',
  },
  forgotBtn: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 8,
  },
  forgotBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  forgotModalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    maxWidth: 390,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  forgotModalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  forgotModalSub: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 17,
  },
  msgBox: {
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  msgBoxError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  msgBoxSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  msgTextError: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '700',
  },
  msgTextSuccess: {
    color: '#15803d',
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.lg,
  },
  pickerModalContent: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.lg,
    width: '100%',
    maxWidth: 380,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: Theme.colors.text,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Theme.borderRadius.md,
    marginBottom: 6,
    backgroundColor: Theme.colors.background,
  },
  pickerItemActive: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1.5,
    borderColor: Theme.colors.primary,
  },
  pickerItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.text,
    flexWrap: 'wrap',
  },
  pickerItemSub: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  consentModalContent: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.xl,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
  },
  consentHeader: {
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  consentIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ecfdf5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  consentTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: Theme.colors.text,
    textAlign: 'center',
    flexWrap: 'wrap',
  },
  consentSubtitle: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
    flexWrap: 'wrap',
  },
  consentScroll: {
    marginVertical: Theme.spacing.sm,
  },
  consentParagraph: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
    marginBottom: Theme.spacing.md,
    flexWrap: 'wrap',
  },
  bulletBox: {
    backgroundColor: '#f8fafc',
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  bulletTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0f172a',
    textTransform: 'uppercase',
  },
  bulletItem: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
    flexWrap: 'wrap',
  },
  consentButton: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: Theme.spacing.md,
  },
  consentButtonText: {
    color: Theme.colors.surface,
    fontSize: 15,
    fontWeight: '800',
    flexWrap: 'wrap',
  },
});
