import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  TextInput, 
  ScrollView 
} from 'react-native';
import { Theme } from '../constants/Theme';
import { X, Banknote, FileText, Minus, Plus, AlertCircle, CheckCircle } from 'lucide-react-native';

interface CustomerStop {
  id: string;
  name: string;
  type: string;
  iceType?: string;
  sackSize?: string;
  plannedQty?: number;
  unitPrice?: number;
  amount: number;
  isInstitutional?: boolean;
  status: string;
}

interface CheckoutModalProps {
  visible: boolean;
  stop: CustomerStop | null;
  onClose: () => void;
  onComplete: (result: {
    method: 'cash' | 'charge';
    deliveredQty: number;
    returnedQty: number;
    totalAmount: number;
    partialReason?: string;
  }) => void;
}

const PARTIAL_REASONS = [
  "Customer Freezer Full",
  "Melted / Damaged in Transit",
  "Customer Requested Less Sacks",
  "Store Space / Power Issue"
];

export default function CheckoutModal({ 
  visible, 
  stop, 
  onClose, 
  onComplete 
}: CheckoutModalProps) {
  const planned = stop?.plannedQty || Math.max(1, Math.round((stop?.amount || 150) / 150));
  const unitPrice =
    stop?.unitPrice ?? (stop?.amount ? Math.round((stop.amount / planned) * 100) / 100 : 150);

  const [deliveredQty, setDeliveredQty] = useState<number>(planned);
  const [selectedReason, setSelectedReason] = useState<string>(PARTIAL_REASONS[0]);
  const [customReason, setCustomReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (visible && stop) {
      const initPlanned = stop.plannedQty || Math.max(1, Math.round((stop.amount || 150) / 150));
      setDeliveredQty(initPlanned);
      setSelectedReason(PARTIAL_REASONS[0]);
      setCustomReason('');
      setIsSubmitting(false);
    }
  }, [visible, stop]);

  if (!stop) return null;

  const returnedQty = Math.max(0, planned - deliveredQty);
  const totalPayable = Math.round(deliveredQty * Math.round(unitPrice * 100)) / 100;
  const isPartial = deliveredQty < planned;

  const handleDecrement = () => {
    if (deliveredQty > 0) {
      setDeliveredQty(prev => prev - 1);
    }
  };

  const handleIncrement = () => {
    if (deliveredQty < planned) {
      setDeliveredQty(prev => prev + 1);
    }
  };

  const handleConfirm = (method: 'cash' | 'charge') => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const reason = isPartial 
      ? (selectedReason === "Other Reason" ? customReason : selectedReason)
      : undefined;

    onComplete({
      method,
      deliveredQty,
      returnedQty,
      totalAmount: totalPayable,
      partialReason: reason
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Confirm Delivery</Text>
              <Text style={styles.stopName}>{stop.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={24} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* Quantity Adjustment Section (Partial Deliveries) */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardLabel}>DELIVERED SACKS QUANTITY</Text>
                <Text style={styles.cardSubLabel}>Planned: {planned} sacks</Text>
              </View>

              <View style={styles.qtyControlsRow}>
                <TouchableOpacity 
                  onPress={handleDecrement}
                  disabled={deliveredQty <= 0}
                  style={[styles.qtyButton, deliveredQty <= 0 && styles.qtyButtonDisabled]}
                >
                  <Minus size={24} color={deliveredQty <= 0 ? Theme.colors.border : Theme.colors.surface} />
                </TouchableOpacity>

                <View style={styles.qtyDisplay}>
                  <Text style={styles.qtyNumber}>{deliveredQty}</Text>
                  <Text style={styles.qtyUnit}>sacks delivered</Text>
                </View>

                <TouchableOpacity 
                  onPress={handleIncrement}
                  disabled={deliveredQty >= planned}
                  style={[styles.qtyButton, deliveredQty >= planned && styles.qtyButtonDisabled]}
                >
                  <Plus size={24} color={deliveredQty >= planned ? Theme.colors.border : Theme.colors.surface} />
                </TouchableOpacity>
              </View>

              {/* Sacks Returned Counter */}
              {isPartial && (
                <View style={styles.returnedBadge}>
                  <AlertCircle size={16} color="#b45309" />
                  <Text style={styles.returnedBadgeText}>
                    {returnedQty} sack{returnedQty > 1 ? 's' : ''} will remain/return on truck
                  </Text>
                </View>
              )}
            </View>

            {/* Partial Delivery Reason Selector */}
            {isPartial && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>REASON FOR PARTIAL DELIVERY *</Text>
                <View style={styles.reasonsContainer}>
                  {PARTIAL_REASONS.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.reasonChip,
                        selectedReason === r && styles.reasonChipActive
                      ]}
                      onPress={() => setSelectedReason(r)}
                    >
                      <Text style={[
                        styles.reasonText,
                        selectedReason === r && styles.reasonTextActive
                      ]}>
                        {r}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Recalculated Payable Amount Card */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total Amount Due</Text>
              <Text style={styles.summaryAmount}>₱{totalPayable.toLocaleString()}</Text>
              <Text style={styles.summarySub}>
                ₱{unitPrice} / sack • {deliveredQty} sacks confirmed
              </Text>
            </View>

            {/* Action Buttons with Double-Submit Guard */}
            <View style={styles.actionContainer}>
              <TouchableOpacity
                disabled={isSubmitting}
                style={[styles.massiveButton, styles.cashButton, isSubmitting && styles.buttonDisabled]}
                onPress={() => handleConfirm('cash')}
              >
                <Banknote size={28} color={Theme.colors.surface} />
                <Text style={styles.massiveButtonText}>
                  {isSubmitting ? "Syncing..." : "Confirm Paid (Cash)"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isSubmitting}
                style={[styles.massiveButton, styles.chargeButton, isSubmitting && styles.buttonDisabled]}
                onPress={() => handleConfirm('charge')}
              >
                <FileText size={28} color={Theme.colors.primaryDark} />
                <Text style={[styles.massiveButtonText, { color: Theme.colors.primaryDark }]}>
                  {isSubmitting ? "Syncing..." : "Confirm Charge Invoice"}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: Theme.borderRadius.xl,
    borderTopRightRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Theme.spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: Theme.colors.text,
  },
  stopName: {
    fontSize: 16,
    color: Theme.colors.primary,
    fontWeight: 'bold',
    marginTop: 2,
  },
  closeBtn: {
    padding: 8,
  },
  scrollArea: {
    marginBottom: Theme.spacing.md,
  },
  card: {
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: Theme.colors.textSecondary,
    letterSpacing: 1,
  },
  cardSubLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Theme.colors.primary,
  },
  qtyControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xs,
  },
  qtyButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyButtonDisabled: {
    backgroundColor: Theme.colors.background,
  },
  qtyDisplay: {
    alignItems: 'center',
  },
  qtyNumber: {
    fontSize: 40,
    fontWeight: '900',
    color: Theme.colors.text,
  },
  qtyUnit: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
  returnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Theme.borderRadius.md,
    marginTop: Theme.spacing.sm,
  },
  returnedBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#92400e',
  },
  reasonsContainer: {
    gap: 8,
    marginTop: Theme.spacing.xs,
  },
  reasonChip: {
    padding: 10,
    borderRadius: Theme.borderRadius.md,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  reasonChipActive: {
    backgroundColor: '#ecfdf5',
    borderColor: Theme.colors.primary,
  },
  reasonText: {
    fontSize: 13,
    color: Theme.colors.text,
    fontWeight: '500',
  },
  reasonTextActive: {
    color: Theme.colors.primary,
    fontWeight: 'bold',
  },
  summaryCard: {
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.lg,
    borderRadius: Theme.borderRadius.lg,
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 42,
    fontWeight: '900',
    color: Theme.colors.primary,
  },
  summarySub: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 4,
  },
  actionContainer: {
    gap: Theme.spacing.md,
    paddingBottom: Theme.spacing.lg,
  },
  massiveButton: {
    height: 68,
    borderRadius: Theme.borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cashButton: {
    backgroundColor: Theme.colors.primary,
  },
  chargeButton: {
    backgroundColor: Theme.colors.accent,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  massiveButtonText: {
    fontSize: 18,
    fontWeight: '900',
    color: Theme.colors.surface,
  },
});
