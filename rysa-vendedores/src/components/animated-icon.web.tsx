import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';

export function AnimatedSplashOverlay() {
  const opacity = useRef(new Animated.Value(1)).current;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    Animated.timing(opacity, {
      toValue: 0,
      duration: 500,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }, [opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.splashOverlay, { opacity }]}>
      <Image style={styles.image} source={require('@/assets/images/icon.png')} />
    </Animated.View>
  );
}

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Image style={styles.heroImage} source={require('@/assets/images/icon.png')} />
    </View>
  );
}

const styles = StyleSheet.create({
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#121820',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  image: {
    width: 120,
    height: 120,
    borderRadius: 24,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
  },
});
