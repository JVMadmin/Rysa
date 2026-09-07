import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ConnectivityBannerProps {
  isOffline?: boolean;
  message?: string;
}

export const ConnectivityBanner: React.FC<ConnectivityBannerProps> = ({
  isOffline = false,
  message,
}) => {
  if (!isOffline && !message) return null;

  return (
    <View style={[styles.container, isOffline ? styles.offline : styles.warning]}>
      <MaterialIcons
        name={isOffline ? 'cloud-off' : 'info-outline'}
        size={18}
        color="#FFFFFF"
        style={styles.icon}
      />
      <Text style={styles.text} numberOfLines={2}>
        {message || 'Sin conexión con el servidor de RYSA. Comprueba tu red.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginHorizontal: 12,
    marginVertical: 6,
  },
  offline: {
    backgroundColor: '#D32F2F',
  },
  warning: {
    backgroundColor: '#F57C00',
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});
