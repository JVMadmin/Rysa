import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

import { trackingService } from '@/services/trackingService';
import { getJornada, jornadaVigente, onSesionTerminada } from '@/lib/api';

// Vive mientras hay sesión. Al montarse (justo después del login o al abrir la
// app con la jornada vigente) pide los permisos de ubicación en orden y arranca
// el rastreo con su servicio de fondo. Cada vez que la app vuelve al frente
// revisa la jornada: si venció (23:59) o se cerró en el servidor, regresa al
// login y apaga el GPS.
export function JornadaGuard({ onSesionTerminada: alTerminar }: { onSesionTerminada: () => void }) {
  const pidiendo = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let activo = true;

    const pedirFondo = () => new Promise<void>((resolve) => {
      Alert.alert(
        'Ubicación durante la jornada',
        'Para que tu supervisor vea tu ruta aunque bloquees el celular, en la siguiente pantalla elige "Permitir todo el tiempo".',
        [{
          text: 'Continuar',
          onPress: async () => {
            const ok = await trackingService.requestBackgroundPermission();
            if (ok) setTimeout(() => trackingService.tryStartForegroundService().catch(() => {}), 1500);
            else Alert.alert('Sin permiso de fondo', 'La ubicación solo se enviará mientras la app esté abierta. Puedes activarlo después en Ajustes → Apps → RYSA Vendedores → Ubicación.');
            resolve();
          },
        }],
        { cancelable: false },
      );
    });

    const iniciar = async () => {
      if (pidiendo.current) return;
      pidiendo.current = true;
      try {
        let fg = await Location.getForegroundPermissionsAsync();
        if (fg.status !== 'granted') fg = await Location.requestForegroundPermissionsAsync();
        if (!activo) return;
        if (fg.status !== 'granted') {
          Alert.alert('Ubicación requerida', 'La app necesita tu ubicación para registrar tu ruta y tus visitas durante la jornada.');
          return;
        }
        await trackingService.iniciarJornada();
        const bg = await Location.getBackgroundPermissionsAsync();
        if (activo && bg.status !== 'granted') await pedirFondo();
      } finally {
        pidiendo.current = false;
      }
    };

    // Pequeña espera para que la pantalla esté visible (Android exige una
    // Activity en primer plano para pedir permisos y arrancar el servicio).
    const t = setTimeout(iniciar, 800);

    const sub = AppState.addEventListener('change', async (estado) => {
      if (estado !== 'active') return;
      if (!jornadaVigente(await getJornada())) {
        await trackingService.stopTracking();
        alTerminar();
        return;
      }
      await trackingService.startTracking(true);
      await trackingService.tryStartForegroundService();
    });

    const quitar = onSesionTerminada(() => {
      trackingService.stopTracking().catch(() => {});
      alTerminar();
    });

    return () => {
      activo = false;
      clearTimeout(t);
      sub.remove();
      quitar();
    };
  }, [alTerminar]);

  return null;
}
