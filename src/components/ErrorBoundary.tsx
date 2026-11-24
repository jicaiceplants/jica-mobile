import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Root ErrorBoundary caught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>IceTrack Startup Issue</Text>
            <Text style={styles.subtitle}>
              An unhandled startup exception occurred. The details below can help diagnose:
            </Text>
            <ScrollView style={styles.errorBox}>
              <Text style={styles.errorText}>
                {this.state.error?.toString() || 'Unknown startup error'}
              </Text>
              {this.state.errorInfo?.componentStack && (
                <Text style={styles.stackText}>
                  {this.state.errorInfo.componentStack}
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity style={styles.button} onPress={this.handleRestart}>
              <Text style={styles.buttonText}>Restart IceTrack</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxHeight: '90%',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#EF4444',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 16,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    maxHeight: 250,
  },
  errorText: {
    color: '#F87171',
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 8,
  },
  stackText: {
    color: '#64748B',
    fontFamily: 'monospace',
    fontSize: 10,
  },
  button: {
    backgroundColor: '#00875A',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
