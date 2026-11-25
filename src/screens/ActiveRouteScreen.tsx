import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Dimensions,
  RefreshControl,
  AppState
} from 'react-native';
import { Theme } from '../constants/Theme';
import {
  MapPin,
  School,
  Store,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  Navigation,
  Wifi,
  WifiOff,
  Radio,
  CheckCircle2,
  Banknote,
  FileText,
  Warehouse,
  Truck,
  RotateCcw,
  Compass,
  ArrowRight,
  TrendingUp,
  Crosshair,
  Route as RouteIcon,
  RefreshCw,
  X,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  AlertTriangle
} from 'lucide-react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import CheckoutModal from '../components/CheckoutModal';
import EmergencySOS from '../components/EmergencySOS';
import {
  queueTransaction,
  getQueuedTransactions,
  queueFinishShift
} from '../services/DatabaseService';
import { stopLocationTracking } from '../services/LocationService';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  fetchTurnByTurnRoute,
  recalculateBypassRoute,
  computeDistanceMeters,
  RouteNavigationPayload,
  RouteStep,
  RouteManeuver
} from '../services/NavigationService';

function renderManeuverIcon(maneuver?: RouteManeuver, size: number = 24, color: string = '#ffffff') {
  switch (maneuver) {
    case 'turn-left':
    case 'turn-slight-left':
    case 'turn-sharp-left':
      return <CornerUpLeft size={size} color={color} />;
    case 'turn-right':
    case 'turn-slight-right':
    case 'turn-sharp-right':
      return <CornerUpRight size={size} color={color} />;
    case 'u-turn-left':
    case 'u-turn-right':
      return <RotateCcw size={size} color={color} />;
    case 'arrive':
      return <CheckCircle2 size={size} color={color} />;
    case 'straight':
    case 'depart':
    default:
      return <ArrowUp size={size} color={color} />;
  }
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function computeDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// Official JICA Ice Plant Origin & Return Address
const GUSA_DEPOT = {
  name: "JICA ICEPLANT",
  address: "#69 Old Road Gusa, CDOC 9000",
  latitude: 8.4770172,
  longitude: 124.6798424,
};

export interface DeliveryLocationStop {
  id: string;
  index: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isInstitutionalHub?: boolean;
  nextManeuver?: string;
  etaMins?: number;
  distanceKm?: number;
  customers: Array<{
    id: string;
    name: string;
    type: string;
    plannedQty: number;
    unitPrice: number;
    amount: number;
    isInstitutional?: boolean;
    loadSlipId?: string;
    hubId?: string;
    hubName?: string;
    productId?: string;
    productName?: string;
    sackSize?: string;
    isAdhoc?: boolean;
    status: 'pending' | 'completed' | 'partial' | 'cancelled';
  }>;
}

export default function ActiveRouteScreen({ route }: any) {
  const navigation = useNavigation<any>();
  const [driverState, setDriverState] = useState<any>(
    () =>
      route?.params?.driver || {
        id: "",
        name: "Driver",
        truckId: "",
        plate: ""
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

  const [activeSlipId, setActiveSlipId] = useState<string | null>(null);
  const [slipNumber, setSlipNumber] = useState<string | null>(null);

  const [locations, setLocations] = useState<DeliveryLocationStop[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [viewMode, setViewMode] = useState<'stops' | 'map'>('stops');
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);

  const [expandedLocations, setExpandedLocations] = useState<Record<string, boolean>>({});

  // Offline queue state
  const [queuedCount, setQueuedCount] = useState(0);

  // Driver GPS position for live in-app map (Default: JICA ICEPLANT origin)
  const [driverPos, setDriverPos] = useState({
    latitude: 8.4770172,
    longitude: 124.6798424,
    heading: 0
  });

  // Map Selected Destination (For Google Maps-style Directions)
  const [selectedMapTarget, setSelectedMapTarget] = useState<DeliveryLocationStop | null>(null);
  const [isFollowingDriver, setIsFollowingDriver] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [routeBypassActive, setRouteBypassActive] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [activeNavRoute, setActiveNavRoute] = useState<RouteNavigationPayload | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // End of Shift Workflow State
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showHandoverSummary, setShowHandoverSummary] = useState(false);
  const [isShiftFinished, setIsShiftFinished] = useState(false);

  // Extra Delivery state & Live Data
  const [showExtraDeliveryModal, setShowExtraDeliveryModal] = useState(false);
  const [extraStore, setExtraStore] = useState('');
  const [extraLocationId, setExtraLocationId] = useState('');
  const [extraQty, setExtraQty] = useState('5');
  const [extraPrice, setExtraPrice] = useState('150');
  const [availableHubs, setAvailableHubs] = useState<any[]>([]);
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [acknowledgedSosAlert, setAcknowledgedSosAlert] = useState<any>(null);

  const mapRef = useRef<MapView>(null);

  const handleSessionKicked = useCallback(
    async (reason: string = SESSION_REVOKED_MESSAGE) => {
      if (revokedHandledRef.current) return;
      revokedHandledRef.current = true;
      stopLocationTracking();
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

  const fetchRouteFromSupabase = useCallback(async () => {
    if (!driver?.id && !driver?.truckId) return;
    setIsLoadingRoute(true);
    try {
      // 1. Fetch live delivery hubs & products (reading canonical standard_price)
      const [{ data: hubsData }, { data: prodsData }] = await Promise.all([
        supabase.from("delivery_hubs").select("*").is("deleted_at", null).eq("is_active", true).order("name"),
        supabase.from("products").select("*").is("deleted_at", null).eq("is_active", true).order("name")
      ]);

      if (hubsData && hubsData.length > 0) {
        setAvailableHubs(hubsData);
        setExtraLocationId(prev => prev || hubsData[0].id);
      }

      if (prodsData && prodsData.length > 0) {
        setAvailableProducts(prodsData);
        setSelectedProductId(prev => prev || prodsData[0].id);
        setExtraPrice(String(prodsData[0].standard_price ?? prodsData[0].price ?? 0));
      }

      const todayStr = getManilaDateString();
      let activeSlip: any = null;

      // 2. Try FastAPI backend first
      try {
        const headers = await getSessionHeaders();
        const url = `${BACKEND_URL}/api/v1/driver/active-dispatch?driver_id=${encodeURIComponent(
          driver.id || ""
        )}&truck_id=${encodeURIComponent(driver.truckId || "")}&shift_date=${todayStr}`;
        const res = await fetch(url, { headers });
        if (res.ok) {
          const json = await res.json();
          if (json?.active_dispatch?.load_slip_items?.length > 0) {
            activeSlip = json.active_dispatch;
          }
        }
      } catch {
        // Fallback direct Supabase
      }

      // 3. Direct Supabase UUID-safe fallback
      if (!activeSlip) {
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

        const { data: slips, error } = await query;
        if (!error && slips && slips.length > 0) {
          const eligible = slips.filter((s: any) => {
            const st = String(s.status || "").toUpperCase();
            const hasItems = Array.isArray(s.load_slip_items) && s.load_slip_items.length > 0;
            return (
              hasItems &&
              ["DISPATCHED", "ACTIVE", "PENDING", "IN_TRANSIT", "IN-TRANSIT"].includes(st)
            );
          });
          activeSlip = eligible.find((s: any) => s.date === todayStr) || eligible[0] || null;
        }
      }

      if (activeSlip && Array.isArray(activeSlip.load_slip_items) && activeSlip.load_slip_items.length > 0) {
        setActiveSlipId(activeSlip.id);
        setSlipNumber(activeSlip.slip_number || activeSlip.id);

        const hubMap = new Map<string, DeliveryLocationStop>();
        activeSlip.load_slip_items.forEach((item: any) => {
          const hub = item.delivery_hubs || {
            id: item.hub_id || `HUB-${hubMap.size + 1}`,
            name: item.hub_name || item.customer_name || "CDO Delivery Hub",
            address: "Cagayan de Oro City",
            latitude: 8.4828,
            longitude: 124.6612
          };
          const hubId = hub.id || `HUB-${hubMap.size + 1}`;
          if (!hubMap.has(hubId)) {
            hubMap.set(hubId, {
              id: hubId,
              index: hubMap.size + 1,
              name: hub.name || "Delivery Hub",
              address: hub.address || "Cagayan de Oro City",
              lat: Number(hub.latitude) || 8.4828,
              lng: Number(hub.longitude) || 124.6612,
              isInstitutionalHub: false,
              nextManeuver: `Proceed to ${hub.name}`,
              etaMins: 5,
              distanceKm: 1.2,
              customers: []
            });
          }
          const plannedQty = Number(item.planned_qty || 0);
          const deliveredQty = Number(item.delivered_qty || 0);
          const itemStatus = String(item.status || "").toLowerCase();
          const isDone =
            itemStatus === "completed" ||
            itemStatus === "partial" ||
            (plannedQty > 0 && deliveredQty >= plannedQty);

          hubMap.get(hubId)!.customers.push({
            id: item.id,
            name: item.customer_name,
            type: item.product_name || "Ice Drop",
            plannedQty,
            unitPrice: Number(item.unit_price ?? 0),
            amount: Number(item.total_amount ?? plannedQty * Number(item.unit_price ?? 0)),
            isInstitutional: false,
            loadSlipId: activeSlip.id,
            hubId,
            hubName: hub.name || item.hub_name || "Delivery Hub",
            productId: item.product_id || undefined,
            productName: item.product_name || "Ice Product",
            sackSize: item.sack_size || "Standard Sack",
            isAdhoc: Boolean(item.is_adhoc),
            status: isDone ? 'completed' : 'pending'
          });
        });

        const loaded = Array.from(hubMap.values());
        setLocations(loaded);
        if (loaded.length > 0) {
          setSelectedMapTarget(prev => prev || loaded[0]);
          setExtraLocationId(prev => prev || loaded[0].id);
        }
      } else {
        setActiveSlipId(null);
        setSlipNumber(null);
        setLocations([]);
      }
    } catch (e) {
      console.warn("Could not load route:", e);
      setLocations([]);
    } finally {
      setIsLoadingRoute(false);
    }
  }, [driver.id, driver.truckId]);

  useFocusEffect(
    useCallback(() => {
      fetchRouteFromSupabase();
    }, [fetchRouteFromSupabase])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", next => {
      if (next === "active") fetchRouteFromSupabase();
    });
    return () => sub.remove();
  }, [fetchRouteFromSupabase]);

  // Realtime sync on load_slips + Strict Single-Session Guard
  useEffect(() => {
    const unsubRevoke = subscribeSessionRevoked((reason) => {
      handleSessionKicked(reason);
    });

    const channel = supabase
      .channel(`active-route-live-${driver.id || "anon"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "load_slips" },
        () => {
          fetchRouteFromSupabase();
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
  }, [driver.id, driver.session_token, fetchRouteFromSupabase, handleSessionKicked]);

  // Poll for Active Emergency SOS Dispatcher Acknowledgements ("Help is on the Way")
  useEffect(() => {
    const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || "https://jica-backend-production.up.railway.app").replace(/\/+$/, "").trim();
    const checkSosStatus = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/v1/telemetry/sos/active`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.alerts && Array.isArray(data.alerts)) {
            const myAck = data.alerts.find((a: any) =>
              (a.truck_id === driver.truckId || a.driver_id === driver.id || a.driver_id === driver.name) &&
              a.status === 'Acknowledged'
            );
            if (myAck) {
              setAcknowledgedSosAlert(myAck);
            }
          }
        }
      } catch (_) { }
    };

    checkSosStatus();
    const interval = setInterval(checkSosStatus, 3500);
    return () => clearInterval(interval);
  }, [driver.truckId, driver.id]);

  // Poll offline queue & watch position
  useEffect(() => {
    const checkQueue = async () => {
      const tx = await getQueuedTransactions();
      setQueuedCount(tx.length);
    };
    checkQueue();
    const interval = setInterval(checkQueue, 4000);

    let locationSub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 10 },
      (loc) => {
        const nextPos = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          heading: loc.coords.heading ?? 0
        };
        setDriverPos(nextPos);

        if (isFollowingDriver && mapRef.current) {
          try {
            mapRef.current.animateCamera({
              center: { latitude: nextPos.latitude, longitude: nextPos.longitude },
              heading: nextPos.heading,
              pitch: isNavigating ? 45 : 35,
              zoom: isNavigating ? 17 : 16
            }, { duration: 600 });
          } catch (cameraErr) {
            // Native camera animation safe catch
          }
        }

        // Automatic Turn-by-Turn Waypoint Advancement ($0 extra cloud calls)
        if (isNavigating && activeNavRoute && activeNavRoute.steps && activeNavRoute.steps.length > 0) {
          const curStep = activeNavRoute.steps[currentStepIndex];
          if (curStep) {
            const distToWaypoint = computeDistanceMeters(
              nextPos.latitude,
              nextPos.longitude,
              curStep.endLocation.latitude,
              curStep.endLocation.longitude
            );
            // If driver reaches within 40m of current turn step, advance to next turn!
            if (distToWaypoint < 40 && currentStepIndex < activeNavRoute.steps.length - 1) {
              setCurrentStepIndex(prev => prev + 1);
            }
          }
        }
      }
    ).then(sub => { locationSub = sub; }).catch(() => { });

    return () => {
      clearInterval(interval);
      if (locationSub) locationSub.remove();
    };
  }, [isFollowingDriver, isNavigating, activeNavRoute, currentStepIndex]);

  // Institutional sorting
  const sortedLocations = useMemo(() => {
    return [...locations].sort((a, b) => {
      const aHasIncompleteInst = a.customers.some(c => c.isInstitutional && c.status !== 'completed');
      const bHasIncompleteInst = b.customers.some(c => c.isInstitutional && c.status !== 'completed');

      const aAllDone = a.customers.every(c => c.status === 'completed');
      const bAllDone = b.customers.every(c => c.status === 'completed');

      if (aAllDone && !bAllDone) return 1;
      if (bAllDone && !aAllDone) return -1;

      if (aHasIncompleteInst && !bHasIncompleteInst) return -1;
      if (!aHasIncompleteInst && bHasIncompleteInst) return 1;

      return a.index - b.index;
    });
  }, [locations]);

  // Sacks & Revenue Calculations
  const {
    totalLoaded,
    totalDelivered,
    totalReturned,
    totalCashRevenue,
    totalChargeRevenue,
    chargeCount
  } = useMemo(() => {
    let loaded = 0;
    let delivered = 0;
    let returned = 0;
    let cash = 0;
    let charge = 0;
    let chargeInvoices = 0;

    locations.forEach(loc => {
      loc.customers.forEach(c => {
        loaded += c.plannedQty;
        if (c.status === 'completed') {
          const del = (c as any).deliveredQty ?? c.plannedQty;
          const ret = (c as any).returnedQty ?? 0;
          const amt = (c as any).confirmedAmount ?? c.amount;
          const method = (c as any).confirmedMethod ?? 'cash';

          delivered += del;
          returned += ret;

          if (method === 'cash') {
            cash += amt;
          } else {
            charge += amt;
            chargeInvoices += 1;
          }
        }
      });
    });

    return {
      totalLoaded: loaded,
      totalDelivered: delivered,
      totalReturned: returned,
      totalCashRevenue: cash,
      totalChargeRevenue: charge,
      chargeCount: chargeInvoices
    };
  }, [locations]);

  const sacksRemainingOnTruck = Math.max(0, totalLoaded - totalDelivered);

  const totalStoresCount = locations.reduce((sum, l) => sum + l.customers.length, 0);
  const totalCompletedCount = locations.reduce((sum, l) => sum + l.customers.filter(c => c.status === 'completed').length, 0);
  const allStoresCompleted = totalCompletedCount === totalStoresCount && totalStoresCount > 0;

  const returnToPlantTarget = useMemo<DeliveryLocationStop>(() => ({
    id: "DEPOT-RETURN",
    index: 999,
    name: GUSA_DEPOT.name,
    address: GUSA_DEPOT.address,
    lat: GUSA_DEPOT.latitude,
    lng: GUSA_DEPOT.longitude,
    nextManeuver: "Follow corridor return route to #69 Old Road Gusa, CDOC 9000",
    customers: []
  }), []);

  // Next Pending Stop for Guidance Banner
  const nextPendingLocation = useMemo(() => {
    const pending = sortedLocations.find(l => l.customers.some(c => c.status !== 'completed'));
    if (pending) return pending;
    if (sortedLocations.length > 0 && allStoresCompleted) return returnToPlantTarget;
    return sortedLocations[0] || returnToPlantTarget;
  }, [sortedLocations, allStoresCompleted, returnToPlantTarget]);

  const activeTarget = selectedMapTarget || nextPendingLocation;

  const toggleLocationExpand = (locId: string) => {
    setExpandedLocations(prev => ({
      ...prev,
      [locId]: !prev[locId]
    }));
  };

  const handleCustomerPress = (customer: any) => {
    if (customer.status === 'completed') return;
    setSelectedCustomer(customer);
    setCheckoutVisible(true);
  };

  const handleCheckoutComplete = async (result: {
    method: 'cash' | 'charge';
    deliveredQty: number;
    returnedQty: number;
    totalAmount: number;
    partialReason?: string;
  }) => {
    if (selectedCustomer) {
      const idempotencyKey = generateUUID();
      const targetSlipId = selectedCustomer.loadSlipId || activeSlipId || undefined;

      await queueTransaction({
        idempotencyKey,
        stopId: selectedCustomer.id,
        loadSlipId: targetSlipId,
        hubId: selectedCustomer.hubId,
        hubName: selectedCustomer.hubName,
        customerName: selectedCustomer.name,
        productId: selectedCustomer.productId,
        productName: selectedCustomer.productName || "Ice Product",
        sackSize: selectedCustomer.sackSize || "Standard Sack",
        plannedQty: selectedCustomer.plannedQty,
        deliveredQty: result.deliveredQty,
        returnedQty: result.returnedQty,
        unitPrice: selectedCustomer.unitPrice,
        totalAmount: result.totalAmount,
        paymentMethod: result.method,
        partialReason: result.partialReason,
        isAdhoc: Boolean(selectedCustomer.isAdhoc)
      });

      setLocations(prev =>
        prev.map(loc => ({
          ...loc,
          customers: loc.customers.map(c =>
            c.id === selectedCustomer.id
              ? {
                ...c,
                status: 'completed',
                deliveredQty: result.deliveredQty,
                returnedQty: result.returnedQty,
                confirmedAmount: result.totalAmount,
                confirmedMethod: result.method,
                partialReason: result.partialReason
              }
              : c
          )
        }))
      );

      setQueuedCount(prev => prev + 1);

      // Immediately push to backend when online so Web Dashboard updates live
      syncDataWithServer(targetSlipId).then(syncRes => {
        if (!syncRes.skipped && syncRes.syncedTransactions > 0) {
          getQueuedTransactions().then(rem => setQueuedCount(rem.length));
        }
      }).catch(() => { });
    }

    setCheckoutVisible(false);
    setSelectedCustomer(null);
  };

  // Dynamic live distance & ETA based on driver GPS
  const liveDistanceKm = useMemo(() => {
    if (!activeTarget) return 0;
    return computeDistanceKm(driverPos.latitude, driverPos.longitude, activeTarget.lat, activeTarget.lng);
  }, [driverPos.latitude, driverPos.longitude, activeTarget]);

  const dynamicEtaMins = useMemo(() => {
    if (!activeTarget) return 0;
    const base = Math.max(1, Math.round((liveDistanceKm / 22) * 60)); // ~22 km/h city delivery speed
    return routeBypassActive ? Math.max(1, base - 1) : base;
  }, [liveDistanceKm, routeBypassActive, activeTarget]);

  // Turn-by-Turn waypoint distance & step calculations
  const currentStep = activeNavRoute?.steps?.[currentStepIndex];
  const totalStepsCount = activeNavRoute?.steps?.length || 1;

  const distToNextWaypointMeters = useMemo(() => {
    if (!currentStep) return 0;
    return computeDistanceMeters(
      driverPos.latitude,
      driverPos.longitude,
      currentStep.endLocation.latitude,
      currentStep.endLocation.longitude
    );
  }, [driverPos.latitude, driverPos.longitude, currentStep]);

  const formattedNextTurnDist = useMemo(() => {
    if (distToNextWaypointMeters >= 1000) {
      return `${(distToNextWaypointMeters / 1000).toFixed(1)} km`;
    }
    return `${distToNextWaypointMeters} m`;
  }, [distToNextWaypointMeters]);

  // Road polyline for live navigation: from driver's current position to destination
  const dynamicNavPolyline = useMemo(() => {
    if (!activeTarget || locations.length === 0) return [];
    const start = { latitude: driverPos.latitude, longitude: driverPos.longitude };
    const dest = { latitude: activeTarget.lat, longitude: activeTarget.lng };

    if (routeBypassActive) {
      // Traffic bypass corridor waypoint
      const mid = {
        latitude: (start.latitude + dest.latitude) / 2 + 0.0015,
        longitude: (start.longitude + dest.longitude) / 2 - 0.002
      };
      return [start, mid, dest];
    }

    // Direct road snapped corridor
    const mid = {
      latitude: (start.latitude + dest.latitude) / 2,
      longitude: (start.longitude + dest.longitude) / 2
    };
    return [start, mid, dest];
  }, [driverPos.latitude, driverPos.longitude, activeTarget, routeBypassActive]);

  // Switch to in-app Directions Map and focus destination
  const focusLocationOnInAppMap = (loc: DeliveryLocationStop) => {
    setSelectedMapTarget(loc);
    setViewMode('map');
    setIsNavigating(false);
    setTimeout(() => {
      mapRef.current?.animateToRegion({
        latitude: loc.lat,
        longitude: loc.lng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      }, 700);
    }, 150);
  };

  // Start true Google Maps-style live navigation from driver GPS
  const startLiveNavigation = async (loc: DeliveryLocationStop) => {
    setSelectedMapTarget(loc);
    setViewMode('map');
    setIsNavigating(true);
    setIsFollowingDriver(true);
    setRouteBypassActive(false);
    setCurrentStepIndex(0);

    // Notify dispatcher backend that route is now IN_TRANSIT
    if (activeSlipId) {
      getSessionHeaders()
        .then(headers =>
          fetch(`${BACKEND_URL}/api/v1/load-slips/${encodeURIComponent(activeSlipId)}/start-route`, {
            method: 'POST',
            headers
          })
        )
        .catch(() => { });
    }

    let originPos = driverPos;
    try {
      const currentLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      originPos = {
        latitude: currentLoc.coords.latitude,
        longitude: currentLoc.coords.longitude,
        heading: currentLoc.coords.heading ?? 0
      };
      setDriverPos(originPos);
    } catch {
      // Use driverPos
    }

    // Fetch standardized Route Navigation payload (FastAPI / Routes API v2 or local mock)
    try {
      const routeData = await fetchTurnByTurnRoute(originPos, loc);
      setActiveNavRoute(routeData);
      setCurrentStepIndex(0);
    } catch {
      setActiveNavRoute(null);
    }

    setTimeout(() => {
      mapRef.current?.animateCamera({
        center: { latitude: originPos.latitude, longitude: originPos.longitude },
        pitch: 45,
        zoom: 17,
        heading: originPos.heading
      }, { duration: 800 });
    }, 200);
  };

  // Recalculate route to bypass traffic / obstacles
  const handleRecalculateRoute = () => {
    setIsRecalculating(true);
    setTimeout(() => {
      setRouteBypassActive(true);
      if (activeNavRoute) {
        const bypassed = recalculateBypassRoute(activeNavRoute, driverPos);
        setActiveNavRoute(bypassed);
      }
      setIsRecalculating(false);
      Alert.alert(
        "Fastest Route Recalculated",
        "Traffic bypass applied via secondary CDO arterial corridor. ETA updated."
      );
    }, 500);
  };

  // Exit navigation mode cleanly
  const handleExitNavigation = () => {
    setIsNavigating(false);
    setIsFollowingDriver(false);
    setRouteBypassActive(false);
    setActiveNavRoute(null);
    setCurrentStepIndex(0);
    if (activeTarget) {
      mapRef.current?.animateToRegion({
        latitude: activeTarget.lat,
        longitude: activeTarget.lng,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      }, 700);
    }
  };

  const recenterOnDriver = () => {
    setIsFollowingDriver(true);
    mapRef.current?.animateCamera({
      center: { latitude: driverPos.latitude, longitude: driverPos.longitude },
      zoom: isNavigating ? 17 : 16,
      heading: driverPos.heading,
      pitch: isNavigating ? 45 : 30
    }, { duration: 600 });
  };

  // Handle End-of-Shift "Complete Delivery Route"
  const handleConfirmCompleteRoute = async () => {
    setShowCompleteConfirm(false);
    setIsShiftFinished(true);

    // 1. Immediately stop background GPS updates
    stopLocationTracking();

    // 2. Trigger final offline queue upload flush
    await syncDataWithServer(activeSlipId || undefined);

    // 3. Mark active Load Slip as DELIVERY_FINISHED on backend (appearing in Shift Closing & Remit)
    if (activeSlipId) {
      let finishedSynced = false;
      try {
        const headers = await getSessionHeaders();
        const res = await fetch(
          `${BACKEND_URL}/api/v1/load-slips/${encodeURIComponent(activeSlipId)}/finish-delivery`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              driver_id: driver.id,
              truck_id: driver.truckId
            })
          }
        );
        finishedSynced = res.ok;
      } catch {
        finishedSynced = false;
      }

      if (!finishedSynced) {
        await queueFinishShift(activeSlipId, driver.id, driver.truckId);
      }
    }

    // 4. Display driver handover summary
    setShowHandoverSummary(true);
  };

  // Final Logout & Return to Dispatch
  const handleFinalHandoverLogout = async () => {
    setShowHandoverSummary(false);
    await syncDataWithServer(activeSlipId || undefined).catch(() => { });
    await logoutMobileSession(driver);
    navigation.replace('Login');
  };

  // Handle Adding Extra Delivery (Unscheduled Order with Live Hubs & Products)
  const handleAddExtraDelivery = () => {
    if (!extraStore.trim()) {
      Alert.alert("Store Name Required", "Please enter a customer or store name for the extra delivery order.");
      return;
    }

    const hubPool = availableHubs.length > 0 ? availableHubs : locations;
    const targetHub = hubPool.find(h => h.id === extraLocationId) || hubPool[0];
    const selectedProduct = availableProducts.find((p: any) => p.id === selectedProductId) || availableProducts[0];

    if (!targetHub) {
      Alert.alert("Delivery Hub Required", "No delivery hub selected. Please ask JICA Office Dispatch to configure hubs in Web Settings.");
      return;
    }

    const qty = Math.max(1, parseInt(extraQty, 10) || 1);
    const defaultProdPrice = Number(selectedProduct?.standard_price ?? selectedProduct?.price ?? 0);
    const parsedPrice = parseFloat(extraPrice);
    const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : defaultProdPrice;
    const amount = Math.round(qty * Math.round(price * 100)) / 100;

    const newCustomer = {
      id: `EXTRA-${Date.now()}`,
      name: `${extraStore.trim()} (Extra Order)`,
      type: "Extra Delivery",
      plannedQty: qty,
      unitPrice: price,
      amount,
      isInstitutional: false,
      loadSlipId: activeSlipId || undefined,
      hubId: targetHub.id,
      hubName: targetHub.name,
      productId: selectedProduct?.id,
      productName: selectedProduct?.name || "Ice Product",
      sackSize: selectedProduct?.sack_size || "Standard Sack",
      isAdhoc: true,
      status: 'pending' as const
    };

    setLocations(prev => {
      const existing = prev.find(loc => loc.id === targetHub.id);
      if (existing) {
        return prev.map(loc =>
          loc.id === targetHub.id
            ? { ...loc, customers: [newCustomer, ...loc.customers] }
            : loc
        );
      }
      return [...prev, {
        id: targetHub.id,
        index: prev.length + 1,
        name: targetHub.name,
        address: targetHub.address || 'Cagayan de Oro City',
        lat: Number(targetHub.latitude) || 8.4828,
        lng: Number(targetHub.longitude) || 124.6612,
        isInstitutionalHub: false,
        nextManeuver: `Proceed to ${targetHub.name}`,
        etaMins: 5,
        distanceKm: 1.5,
        customers: [newCustomer]
      }];
    });

    setExpandedLocations(prev => ({ ...prev, [targetHub.id]: true }));
    setShowExtraDeliveryModal(false);
    setExtraStore('');
  };

  const renderLocationGroup = ({ item: loc }: { item: DeliveryLocationStop }) => {
    const isExpanded = expandedLocations[loc.id];
    const isInstitutionalGroup = loc.customers.some(c => c.isInstitutional);
    const completedCount = loc.customers.filter(c => c.status === 'completed').length;
    const totalCount = loc.customers.length;
    const isAllCompleted = completedCount === totalCount && totalCount > 0;

    return (
      <View style={[
        styles.locationCard,
        isInstitutionalGroup && !isAllCompleted && styles.institutionalCard,
        isAllCompleted && styles.completedCard
      ]}>
        <TouchableOpacity
          style={styles.locationHeader}
          onPress={() => toggleLocationExpand(loc.id)}
          activeOpacity={0.7}
        >
          <View style={styles.locationHeaderLeft}>
            <View style={[styles.iconContainer, isInstitutionalGroup && !isAllCompleted && styles.institutionalIconBg]}>
              {isAllCompleted ? (
                <CheckCircle size={22} color="#00875A" />
              ) : isInstitutionalGroup ? (
                <School size={22} color="#b45309" />
              ) : (
                <MapPin size={22} color="#00875A" />
              )}
            </View>
            <View style={styles.locationInfo}>
              {isInstitutionalGroup && !isAllCompleted && (
                <Text style={styles.priorityBadge}>PRIORITY: INSTITUTIONAL / SCHOOL</Text>
              )}
              <Text style={[styles.locationName, isAllCompleted && styles.completedText]}>
                {loc.index}. {loc.name}
              </Text>
              <Text style={styles.locationAddress}>{loc.address}</Text>
              <Text style={styles.completionText}>{completedCount} / {totalCount} Stores Delivered</Text>
            </View>
          </View>

          <View style={styles.locationHeaderRight}>
            {!isAllCompleted && (
              <TouchableOpacity
                style={styles.inAppNavBtn}
                onPress={() => startLiveNavigation(loc)}
                accessibilityLabel="Start Live Navigation"
              >
                <Navigation size={14} color="#ffffff" />
                <Text style={styles.inAppNavText}>Start</Text>
              </TouchableOpacity>
            )}
            {isExpanded ? (
              <ChevronUp size={22} color={Theme.colors.textSecondary} />
            ) : (
              <ChevronDown size={22} color={Theme.colors.textSecondary} />
            )}
          </View>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.customersContainer}>
            {loc.customers.map((c: any, index) => {
              const customerCompleted = c.status === 'completed';
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.customerItem,
                    index < loc.customers.length - 1 && styles.borderBottom,
                    customerCompleted && styles.completedCustomerItem
                  ]}
                  onPress={() => handleCustomerPress(c)}
                  disabled={customerCompleted}
                >
                  <View style={styles.customerLeft}>
                    <Store size={18} color={customerCompleted ? Theme.colors.border : Theme.colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.customerName, customerCompleted && styles.completedText]}>
                        {c.name}
                      </Text>
                      <Text style={styles.customerSub}>
                        {c.plannedQty} sacks • ₱{c.unitPrice}/sack • {c.isInstitutional ? 'Institutional Priority' : 'Standard Drop'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.customerRight}>
                    {customerCompleted ? (
                      <View style={styles.doneBadge}>
                        <CheckCircle size={14} color="#00875A" />
                        <Text style={styles.doneText}>
                          {c.deliveredQty} Sacks (₱{(c.confirmedAmount || c.amount).toLocaleString()})
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.actionPrompt}>
                        <Text style={styles.pendingText}>Tap to Checkout</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 100% Responsive Top Telemetry & Offline Status Banner */}
      <View style={styles.syncBanner}>
        <View style={styles.syncStatusLeft}>
          {queuedCount > 0 ? (
            <>
              <WifiOff size={15} color="#d97706" />
              <Text style={styles.syncBannerTextOffline}>
                Offline • {queuedCount} queued locally
              </Text>
            </>
          ) : (
            <>
              <Wifi size={15} color="#00875A" />
              <Text style={styles.syncBannerTextSynced}>All Deliveries Synced with Dispatch</Text>
            </>
          )}
        </View>

        <View style={styles.shiftGpsBadge}>
          <Radio size={12} color="#00875A" />
          <Text style={styles.shiftGpsText}>
            {isShiftFinished ? "Shift Ended" : "Phone GPS Active"}
          </Text>
        </View>
      </View>

      {/* Dispatcher SOS Acknowledged Green Banner */}
      {acknowledgedSosAlert && (
        <View style={styles.sosAckBanner}>
          <View style={styles.sosAckLeft}>
            <CheckCircle2 size={22} color="#15803d" />
            <View style={{ flex: 1 }}>
              <Text style={styles.sosAckTitle}>Help is on the Way!</Text>
              <Text style={styles.sosAckText}>
                {acknowledgedSosAlert.dispatcher_reply || "Mechanic dispatch en route to your coordinates."}
                {acknowledgedSosAlert.acknowledged_by ? ` (From: ${acknowledgedSosAlert.acknowledged_by})` : ""}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.sosAckDismissBtn}
            onPress={() => setAcknowledgedSosAlert(null)}
          >
            <Text style={styles.sosAckDismissText}>I Am Safe / Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sacks on Truck Live Reconciliation Banner */}
      <View style={styles.sacksReconciliationBanner}>
        <View style={styles.sackMetric}>
          <Text style={styles.sackMetricValue}>{sacksRemainingOnTruck}</Text>
          <Text style={styles.sackMetricLabel}>Remaining Sacks</Text>
        </View>
        <View style={styles.sackDivider} />
        <View style={styles.sackMetric}>
          <Text style={[styles.sackMetricValue, { color: '#00875A' }]}>{totalDelivered}</Text>
          <Text style={styles.sackMetricLabel}>Delivered</Text>
        </View>
        {totalReturned > 0 && (
          <>
            <View style={styles.sackDivider} />
            <View style={styles.sackMetric}>
              <Text style={[styles.sackMetricValue, { color: '#b45309' }]}>{totalReturned}</Text>
              <Text style={styles.sackMetricLabel}>Returned</Text>
            </View>
          </>
        )}
      </View>

      {/* View Switcher: Checklist vs. In-App Live Map */}
      <View style={styles.viewSwitcherBar}>
        <TouchableOpacity
          style={[styles.switchTab, viewMode === 'stops' && styles.switchTabActive]}
          onPress={() => setViewMode('stops')}
        >
          <Store size={16} color={viewMode === 'stops' ? '#00875A' : '#64748b'} />
          <Text style={[styles.switchTabText, viewMode === 'stops' && styles.switchTabTextActive]}>
            Stops Checklist ({totalCompletedCount}/{totalStoresCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.switchTab, viewMode === 'map' && styles.switchTabActive]}
          onPress={() => setViewMode('map')}
        >
          <Navigation size={16} color={viewMode === 'map' ? '#00875A' : '#64748b'} />
          <Text style={[styles.switchTabText, viewMode === 'map' && styles.switchTabTextActive]}>
            In-App Map Directions
          </Text>
        </TouchableOpacity>
      </View>

      {/* View Content */}
      {viewMode === 'stops' ? (
        <>
          {/* Responsive Header & Extra Delivery Button */}
          <View style={styles.routeHeaderContainer}>
            <View style={styles.routeTitleRow}>
              <Text style={styles.title}>Today&apos;s Delivery Stops</Text>
              <Text style={styles.subtitle}>{totalCompletedCount} of {totalStoresCount} Stores Delivered</Text>
            </View>

            {/* Renamed & Responsively Constrained Extra Delivery Button */}
            <TouchableOpacity
              style={styles.extraDeliveryButton}
              onPress={() => setShowExtraDeliveryModal(true)}
              activeOpacity={0.85}
            >
              <View style={styles.extraDeliveryIconBox}>
                <Plus size={18} color="#ffffff" />
              </View>
              <View style={styles.extraDeliveryTextBox}>
                <Text style={styles.extraDeliveryTitle}>+ Extra Delivery</Text>
                <Text style={styles.extraDeliverySub}>Add walk-in or unscheduled order</Text>
              </View>
            </TouchableOpacity>
          </View>

          <FlatList
            data={sortedLocations}
            keyExtractor={item => item.id}
            renderItem={renderLocationGroup}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isLoadingRoute}
                onRefresh={fetchRouteFromSupabase}
                colors={[Theme.colors.primary]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Truck size={38} color="#00875A" />
                </View>
                <Text style={styles.emptyTitle}>No Dispatched Route Assigned</Text>
                <Text style={styles.emptySubtitle}>
                  Truck {driver.truckId} has no active dispatch manifest for today. Once the dispatcher creates and saves today&apos;s load slip on the Web Dashboard, your route stops will appear here immediately.
                </Text>
                <TouchableOpacity
                  style={styles.refreshRouteButton}
                  onPress={fetchRouteFromSupabase}
                  activeOpacity={0.8}
                  disabled={isLoadingRoute}
                >
                  <RefreshCw size={18} color="#FFFFFF" />
                  <Text style={styles.refreshRouteButtonText}>
                    {isLoadingRoute ? "Checking Server..." : "Check for Dispatched Route"}
                  </Text>
                </TouchableOpacity>
              </View>
            }
          />
        </>
      ) : (
        /* In-App Native MapView ($0 Extra Cost - No MapId passed) */
        <View style={styles.mapContainer}>
          {isNavigating ? (
            /* Google Maps-Style Live Turn-by-Turn Navigation Header */
            <View style={styles.navLiveBanner}>
              <View style={styles.navLiveTopRow}>
                <View style={styles.navLiveTurnBox}>
                  {renderManeuverIcon(currentStep?.maneuver, 24, "#ffffff")}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.navLiveHeaderBadgeRow}>
                    <Text style={styles.navLiveDestName} numberOfLines={1}>
                      Turn {currentStepIndex + 1} of {totalStepsCount} • In {formattedNextTurnDist}
                    </Text>
                    <View style={[styles.navLiveModeBadge, routeBypassActive && styles.navLiveModeBadgeBypass]}>
                      <Text style={styles.navLiveModeText}>
                        {routeBypassActive ? "Bypass Active" : "Fastest Route"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.navLiveManeuverText}>
                    {currentStep?.instruction || activeTarget?.nextManeuver || "Continue straight to destination"}
                  </Text>
                  <View style={styles.navLiveMetricsRow}>
                    <Text style={styles.navLiveMetricsText}>
                      Trip: {liveDistanceKm} km • ~{dynamicEtaMins} mins
                    </Text>
                    <Text style={styles.navLiveTrafficText}>
                      {routeBypassActive ? "⚡ Coastal bypass" : "🟢 CDO Normal Flow"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Navigation Quick Action Controls */}
              <View style={styles.navLiveActionButtonsRow}>
                <TouchableOpacity
                  style={styles.navRecalcBtn}
                  onPress={handleRecalculateRoute}
                  activeOpacity={0.8}
                  disabled={isRecalculating}
                >
                  <RefreshCw size={13} color="#ffffff" />
                  <Text style={styles.navRecalcBtnText}>
                    {isRecalculating ? "Recalculating..." : "Recalculate Fastest Route"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.navExitBtn}
                  onPress={handleExitNavigation}
                  activeOpacity={0.8}
                >
                  <X size={13} color="#cbd5e1" />
                  <Text style={styles.navExitBtnText}>Exit Navigation</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* Standard Route Overview Guidance Card */
            <>
              <View style={styles.mapNavGuidanceCard}>
                <View style={styles.mapNavGuidanceLeft}>
                  <View style={styles.guidanceIconBox}>
                    <Navigation size={22} color="#ffffff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.guidanceBadgeRow}>
                      <Text style={styles.guidanceNextTitle}>
                        {activeTarget ? activeTarget.name : "All Stops Delivered"}
                      </Text>
                      <View style={styles.trafficHelperBadge}>
                        <Text style={styles.trafficHelperText}>Fastest Corridor</Text>
                      </View>
                    </View>
                    <Text style={styles.guidanceStepText}>
                      {activeTarget ? activeTarget.nextManeuver : "Return to Gusa Depot for physical cash remittance."}
                    </Text>
                    <View style={styles.guidanceMetricsRow}>
                      <Text style={styles.guidanceEtaText}>
                        {liveDistanceKm} km • ~{dynamicEtaMins} mins
                      </Text>
                      <TouchableOpacity
                        style={styles.startNavBannerBtn}
                        onPress={() => startLiveNavigation(activeTarget)}
                        activeOpacity={0.8}
                      >
                        <Navigation size={13} color="#ffffff" />
                        <Text style={styles.startNavBannerBtnText}>Start Live Navigation</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>

              {/* Destination Quick Selector Chips */}
              <View style={styles.destChipsOverlay}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.destChipsScroll}>
                  {locations.map((loc) => {
                    const isSelected = activeTarget?.id === loc.id;
                    const isDone = loc.customers.every(c => c.status === 'completed');
                    return (
                      <TouchableOpacity
                        key={loc.id}
                        style={[
                          styles.destChip,
                          isSelected && styles.destChipSelected,
                          isDone && styles.destChipDone
                        ]}
                        onPress={() => focusLocationOnInAppMap(loc)}
                      >
                        <Text style={[
                          styles.destChipText,
                          isSelected && styles.destChipTextSelected,
                          isDone && styles.destChipTextDone
                        ]}>
                          {loc.index}. {loc.name} {isDone ? '✓' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </>
          )}

          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: 8.4772,
              longitude: 124.6540,
              latitudeDelta: 0.045,
              longitudeDelta: 0.045,
            }}
            showsUserLocation={true}
            showsCompass={true}
            showsTraffic={false}
            onTouchStart={() => setIsFollowingDriver(false)}
          >
            {/* Road-snapped Polyline: drawn strictly when stops exist and route is loaded */}
            {locations.length > 0 && (
              isNavigating && activeNavRoute?.overviewPolyline && activeNavRoute.overviewPolyline.length > 0 ? (
                <Polyline
                  coordinates={activeNavRoute.overviewPolyline}
                  strokeColor={routeBypassActive ? "#2563eb" : "#00875A"}
                  strokeWidth={5}
                />
              ) : isNavigating && dynamicNavPolyline.length > 0 ? (
                <Polyline
                  coordinates={dynamicNavPolyline}
                  strokeColor="#2563eb"
                  strokeWidth={5}
                />
              ) : null
            )}

            {/* JICA Ice Plant Origin Marker */}
            <Marker
              coordinate={{ latitude: GUSA_DEPOT.latitude, longitude: GUSA_DEPOT.longitude }}
              title="JICA ICEPLANT"
              description="#69 Old Road Gusa, CDOC 9000"
              pinColor="#00875A"
            />

            {/* 7 CDO Stop Markers */}
            {locations.map((loc) => {
              const allDone = loc.customers.every(c => c.status === 'completed');
              const hasSchool = loc.customers.some(c => c.isInstitutional);
              const pinColor = allDone ? '#00875A' : hasSchool ? '#d97706' : '#2563eb';

              return (
                <Marker
                  key={loc.id}
                  coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                  title={`${loc.index}. ${loc.name}`}
                  description={`${loc.customers.length} stores • ${allDone ? 'Delivered' : 'Pending Deliveries'}`}
                  pinColor={pinColor}
                />
              );
            })}

            {/* Driver Truck Live Marker */}
            <Marker
              coordinate={{ latitude: driverPos.latitude, longitude: driverPos.longitude }}
              title={`Truck ${driver.truckId}`}
              description={`Driver: ${driver.name}`}
              pinColor="#dc2626"
            />
          </MapView>

          {/* Floating Camera Follow Me / Recenter Button */}
          <TouchableOpacity
            style={[styles.recenterFab, isFollowingDriver && styles.recenterFabActive]}
            onPress={recenterOnDriver}
            activeOpacity={0.8}
            accessibilityLabel="Recenter on moving vehicle"
          >
            <Crosshair size={22} color={isFollowingDriver ? '#00875A' : '#1e293b'} />
            <Text style={[styles.recenterText, isFollowingDriver && styles.recenterTextActive]}>
              {isFollowingDriver ? "Tracking" : "Follow Me"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Prominent Complete Delivery Route Button */}
      <View style={styles.bottomActionBar}>
        <TouchableOpacity
          style={[
            styles.completeRouteButton,
            isShiftFinished && styles.completeRouteButtonFinished
          ]}
          onPress={() => {
            if (isShiftFinished) {
              setShowHandoverSummary(true);
            } else {
              setShowCompleteConfirm(true);
            }
          }}
          activeOpacity={0.85}
        >
          <CheckCircle2 size={20} color="#ffffff" />
          <Text style={styles.completeRouteButtonText}>
            {isShiftFinished
              ? "View Remittance Handover Summary"
              : allStoresCompleted
                ? "Complete Delivery Route & Return to Depot"
                : "Finish Shift & Return to JICA ICEPLANT"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Floating Emergency SOS (Top-right corner, active after login) */}
      <EmergencySOS driver={{ ...driver, routeId: activeSlipId || slipNumber || undefined }} />

      {/* Checkout Modal */}
      <CheckoutModal
        visible={checkoutVisible}
        stop={selectedCustomer}
        onClose={() => setCheckoutVisible(false)}
        onComplete={handleCheckoutComplete}
      />

      {/* Confirmation Dialog: Finish Route */}
      <Modal
        visible={showCompleteConfirm}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCompleteConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconBox}>
              <RotateCcw size={32} color="#00875A" />
            </View>
            <Text style={styles.confirmTitle}>Finish Shift & Return to Plant?</Text>
            <Text style={styles.confirmMessage}>
              Confirm that all deliveries for {driver.truckId} are concluded and you are returning to JICA ICEPLANT:
              {'\n\n'}
              <Text style={{ fontWeight: 'bold' }}>JICA ICEPLANT, #69 Old Road Gusa, CDOC 9000</Text>
              {'\n\n'}
              GPS tracking will be stopped immediately and all remaining SQLite records will be synchronized.
            </Text>

            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setShowCompleteConfirm(false)}
              >
                <Text style={styles.confirmCancelText}>Continue Route</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmProceedBtn}
                onPress={handleConfirmCompleteRoute}
              >
                <Text style={styles.confirmProceedText}>Yes, Finish & Return</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Driver End-of-Shift Handover Summary Modal */}
      <Modal
        visible={showHandoverSummary}
        transparent={true}
        animationType="slide"
        onRequestClose={() => { }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.handoverCard}>
            <View style={styles.handoverHeader}>
              <CheckCircle2 size={30} color="#00875A" />
              <View>
                <Text style={styles.handoverTitle}>End-of-Shift Handover</Text>
                <Text style={styles.handoverSubtitle}>
                  Vehicle: {driver.truckId} • Driver: {driver.name}
                </Text>
              </View>
            </View>

            <Text style={styles.handoverInstruction}>
              Return to plant: <Text style={{ fontWeight: 'bold' }}>JICA ICEPLANT, #69 Old Road Gusa, CDOC 9000</Text>. Present this summary to the cashier safe:
            </Text>

            <View style={styles.summaryMetrics}>
              {/* Cash to Remit */}
              <View style={styles.metricRowCash}>
                <View style={styles.metricLabelGroup}>
                  <Banknote size={20} color="#00875A" />
                  <Text style={styles.metricRowTitle}>Total Cash to Remit to Safe</Text>
                </View>
                <Text style={styles.metricCashValue}>
                  ₱ {totalCashRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </Text>
              </View>

              {/* Charge Invoices */}
              <View style={styles.metricRowCharge}>
                <View style={styles.metricLabelGroup}>
                  <FileText size={20} color="#2563eb" />
                  <Text style={styles.metricRowTitle}>Charge Invoices Signed</Text>
                </View>
                <Text style={styles.metricChargeValue}>
                  {chargeCount} invoices (₱ {totalChargeRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })})
                </Text>
              </View>

              {/* Unsold Sacks for Restock */}
              <View style={styles.metricRowRestock}>
                <View style={styles.metricLabelGroup}>
                  <Warehouse size={20} color="#d97706" />
                  <Text style={styles.metricRowTitle}>Unsold Sacks to Cold Storage</Text>
                </View>
                <Text style={styles.metricRestockValue}>
                  {sacksRemainingOnTruck} sacks to unload
                </Text>
              </View>
            </View>

            <View style={styles.complianceNote}>
              <Text style={styles.complianceNoteText}>
                ✓ Shift marked as "Delivery Finished" — Ready for Cashier Remit.
                {'\n'}
                ✓ Smartphone GPS tracking has been fully deactivated.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.finalLogoutBtn}
              onPress={handleFinalHandoverLogout}
            >
              <Text style={styles.finalLogoutText}>Confirm Handover & Log Out</Text>
              <ArrowRight size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Extra Delivery Modal (formerly Ad-Hoc Drop) */}
      <Modal
        visible={showExtraDeliveryModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowExtraDeliveryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.adHocModalCard}>
            <Text style={styles.adHocModalTitle}>Add Extra Delivery</Text>
            <Text style={styles.adHocModalSub}>Add walk-in or unscheduled order requested along your route.</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Store / Customer Name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Chowking Centrio Stall 2"
                value={extraStore}
                onChangeText={setExtraStore}
              />
            </View>

            {availableHubs.length === 0 || availableProducts.length === 0 ? (
              <View style={styles.emptyExtraNotice}>
                <AlertTriangle size={24} color="#b45309" />
                <Text style={styles.emptyExtraNoticeText}>
                  No delivery hubs or ice products configured yet. Please ask JICA Office Dispatch to add them in Web Settings.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Select Nearest Delivery Hub *</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hubChipsRow}>
                    {(availableHubs.length > 0 ? availableHubs : locations).map((loc: any) => (
                      <TouchableOpacity
                        key={loc.id}
                        style={[styles.hubChip, extraLocationId === loc.id && styles.hubChipActive]}
                        onPress={() => setExtraLocationId(loc.id)}
                      >
                        <Text style={[styles.hubChipText, extraLocationId === loc.id && styles.hubChipTextActive]}>
                          {loc.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Select Ice Product *</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hubChipsRow}>
                    {availableProducts.map((p: any) => {
                      const prodPrice = Number(p.standard_price ?? p.price ?? 0);
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.hubChip, selectedProductId === p.id && styles.hubChipActive]}
                          onPress={() => {
                            setSelectedProductId(p.id);
                            setExtraPrice(String(prodPrice));
                          }}
                        >
                          <Text style={[styles.hubChipText, selectedProductId === p.id && styles.hubChipTextActive]}>
                            {p.name} (₱{prodPrice})
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={styles.rowInputs}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Sacks</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="number-pad"
                      value={extraQty}
                      onChangeText={setExtraQty}
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Price / Sack (₱)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="decimal-pad"
                      value={extraPrice}
                      onChangeText={setExtraPrice}
                    />
                  </View>
                </View>
              </>
            )}

            <View style={styles.adHocModalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowExtraDeliveryModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleAddExtraDelivery}
              >
                <Text style={styles.modalConfirmText}>Add Extra Delivery</Text>
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
  // 100% Responsive Top Telemetry Banner
  syncBanner: {
    backgroundColor: '#ffffff',
    paddingLeft: 16,
    paddingRight: 64, // Leaves room for top-right Emergency SOS button
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  syncStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  syncBannerTextSynced: {
    fontSize: 12,
    fontWeight: '700',
    color: '#00875A',
  },
  syncBannerTextOffline: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d97706',
  },
  shiftGpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  shiftGpsText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
    textTransform: 'uppercase',
  },
  sacksReconciliationBanner: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 16,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  sackMetric: {
    alignItems: 'center',
  },
  sackMetricValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
  },
  sackMetricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    marginTop: 1,
  },
  sackDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  viewSwitcherBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    padding: 6,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  switchTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 6,
  },
  switchTabActive: {
    backgroundColor: '#e6f4ea',
  },
  switchTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  switchTabTextActive: {
    color: '#00875A',
    fontWeight: '800',
  },

  // Route Header & Extra Delivery
  routeHeaderContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  routeTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: Theme.colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
  extraDeliveryButton: {
    width: '100%',
    backgroundColor: '#00875A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#00875A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  extraDeliveryIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  extraDeliveryTextBox: {
    flex: 1,
  },
  extraDeliveryTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  extraDeliverySub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },

  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 110,
  },
  locationCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  institutionalCard: {
    borderColor: '#f59e0b',
    borderLeftWidth: 4,
  },
  completedCard: {
    borderColor: '#bbf7d0',
    backgroundColor: '#f8fafc',
  },
  locationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Theme.spacing.md,
  },
  locationHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#e6f4ea',
    justifyContent: 'center',
    alignItems: 'center',
  },
  institutionalIconBg: {
    backgroundColor: '#fef3c7',
  },
  locationInfo: {
    flex: 1,
  },
  priorityBadge: {
    fontSize: 9,
    fontWeight: '900',
    color: '#b45309',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  locationName: {
    fontSize: 15,
    fontWeight: '800',
    color: Theme.colors.text,
    flexWrap: 'wrap',
  },
  locationAddress: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 1,
    flexWrap: 'wrap',
  },
  completionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#00875A',
    marginTop: 2,
  },
  locationHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inAppNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00875A',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
  },
  inAppNavText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  customersContainer: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#fafafa',
  },
  customerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 12,
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  completedCustomerItem: {
    opacity: 0.6,
  },
  customerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  customerName: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.text,
    flexWrap: 'wrap',
  },
  customerSub: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 1,
    flexWrap: 'wrap',
  },
  customerRight: {
    alignItems: 'flex-end',
  },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  doneText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#00875A',
  },
  actionPrompt: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pendingText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#b45309',
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
  },

  // Map View Styles
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  // Google Maps-Style Live Turn-by-Turn Banner
  navLiveBanner: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  navLiveTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  navLiveTurnBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#00875A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
    shadowColor: '#00875A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  navLiveHeaderBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navLiveDestName: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
    flex: 1,
  },
  navLiveModeBadge: {
    backgroundColor: 'rgba(0, 135, 90, 0.3)',
    borderWidth: 1,
    borderColor: '#00875A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  navLiveModeBadgeBypass: {
    backgroundColor: 'rgba(37, 99, 235, 0.3)',
    borderColor: '#3b82f6',
  },
  navLiveModeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34d399',
    textTransform: 'uppercase',
  },
  navLiveManeuverText: {
    fontSize: 13,
    color: '#e2e8f0',
    marginTop: 4,
    lineHeight: 18,
    fontWeight: '600',
  },
  navLiveMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  navLiveMetricsText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#34d399',
  },
  navLiveTrafficText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '700',
  },
  navLiveActionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  navRecalcBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  navRecalcBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  navExitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  navExitBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  startNavBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00875A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  startNavBannerBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  mapNavGuidanceCard: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  mapNavGuidanceLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  guidanceIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#00875A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  guidanceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  guidanceNextTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
    flex: 1,
  },
  trafficHelperBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  trafficHelperText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#cbd5e1',
    textTransform: 'uppercase',
  },
  guidanceStepText: {
    fontSize: 12,
    color: '#e2e8f0',
    marginTop: 3,
    lineHeight: 16,
  },
  guidanceMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  guidanceEtaText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#34d399',
  },
  guidanceTrafficStatus: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },

  // Destination Chips Overlay
  destChipsOverlay: {
    position: 'absolute',
    top: 102,
    left: 0,
    right: 0,
    zIndex: 9,
  },
  destChipsScroll: {
    paddingHorizontal: 12,
    gap: 6,
  },
  destChip: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  destChipSelected: {
    backgroundColor: '#00875A',
    borderColor: '#00875A',
  },
  destChipDone: {
    backgroundColor: '#f1f5f9',
    borderColor: '#bbf7d0',
  },
  destChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  destChipTextSelected: {
    color: '#ffffff',
    fontWeight: '800',
  },
  destChipTextDone: {
    color: '#00875A',
  },

  map: {
    width: '100%',
    height: '100%',
  },

  recenterFab: {
    position: 'absolute',
    bottom: 92,
    right: 16,
    zIndex: 10,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  recenterFabActive: {
    borderColor: '#00875A',
    backgroundColor: '#f0fdf4',
  },
  recenterText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1e293b',
  },
  recenterTextActive: {
    color: '#00875A',
  },

  // Bottom Action Bar
  bottomActionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  completeRouteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00875A',
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#00875A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  completeRouteButtonFinished: {
    backgroundColor: '#1e293b',
  },
  completeRouteButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Confirmation Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  confirmIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e6f4ea',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 19,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  confirmProceedBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#00875A',
    alignItems: 'center',
  },
  confirmProceedText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },

  // Handover Summary Screen
  handoverCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    maxWidth: 420,
  },
  handoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 14,
  },
  handoverTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
  },
  handoverSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 1,
  },
  handoverInstruction: {
    fontSize: 12,
    color: '#475569',
    marginVertical: 14,
    lineHeight: 18,
  },
  summaryMetrics: {
    gap: 10,
  },
  metricRowCash: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1.5,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 14,
  },
  metricRowCharge: {
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    padding: 14,
  },
  metricRowRestock: {
    backgroundColor: '#fffbeb',
    borderWidth: 1.5,
    borderColor: '#fde68a',
    borderRadius: 12,
    padding: 14,
  },
  metricLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricRowTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  metricCashValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#15803d',
    marginTop: 6,
  },
  metricChargeValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#1d4ed8',
    marginTop: 6,
  },
  metricRestockValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#b45309',
    marginTop: 6,
  },
  complianceNote: {
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  complianceNoteText: {
    fontSize: 10,
    color: '#64748b',
    lineHeight: 15,
  },
  finalLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  finalLogoutText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  // Extra Delivery Modal (formerly Ad-Hoc)
  adHocModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  adHocModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  adHocModalSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  hubChipsRow: {
    flexDirection: 'row',
  },
  hubChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    marginRight: 6,
  },
  hubChipActive: {
    backgroundColor: '#00875A',
  },
  hubChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  hubChipTextActive: {
    color: '#ffffff',
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 12,
  },
  adHocModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#00875A',
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  emptyContainer: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    marginVertical: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  refreshRouteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#00875A',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#00875A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  refreshRouteButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  sosAckBanner: {
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1.5,
    borderBottomColor: '#86efac',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sosAckLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sosAckTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#15803d',
  },
  sosAckText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
    marginTop: 2,
    lineHeight: 16,
  },
  sosAckDismissBtn: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sosAckDismissText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyExtraNotice: {
    backgroundColor: '#fffbeb',
    borderWidth: 1.5,
    borderColor: '#fde68a',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    marginVertical: 10,
  },
  emptyExtraNoticeText: {
    fontSize: 13,
    color: '#92400e',
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 18,
  },
});
