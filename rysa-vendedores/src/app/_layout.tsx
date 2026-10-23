import React, { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { LoginScreen } from '@/components/LoginScreen';
import AppTabs from '@/components/app-tabs';
import { JornadaGuard } from '@/components/JornadaGuard';

// Se importa al arrancar para que la tarea de ubicación de fondo quede
// definida a nivel de módulo (requisito de expo-location / TaskManager).
import '@/services/trackingService';

SplashScreen.preventAutoHideAsync().catch(() => {});

function MainContent() {
  const { user, loading, setUser } = useAuth();
  const terminarSesion = React.useCallback(() => setUser(null), [setUser]);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#121820',
        }}
      >
        <ActivityIndicator size="large" color="#D32F2F" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onLoginSuccess={setUser} />;
  }

  // Con sesión: la jornada mantiene el GPS activo hasta el cierre del día.
  return (
    <>
      <JornadaGuard onSesionTerminada={terminarSesion} />
      <AppTabs />
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#121820" translucent={false} />
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <MainContent />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
