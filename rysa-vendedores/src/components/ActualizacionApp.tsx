import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buscarActualizacion, descargarEInstalar, versionInstalada, VersionPublicada,
} from '@/services/updateService';

const CADA_MS = 30 * 60 * 1000;

// Revisión manual (botón «Buscar actualización» del login).
const pedidos = new Set<() => void>();
export function pedirRevisionActualizacion() {
  pedidos.forEach((fn) => fn());
}

// Aviso de versión nueva: se revisa al abrir la app y al volver a ella (cada
// 30 min como máximo). «Más tarde» la oculta hasta la siguiente apertura,
// salvo que la versión sea obligatoria.
export function ActualizacionApp() {
  const [nueva, setNueva] = useState<VersionPublicada | null>(null);
  const [pospuesta, setPospuesta] = useState(false);
  const [avance, setAvance] = useState<number | null>(null);
  const ultima = useRef(0);

  const revisar = useCallback(async (manual = false) => {
    if (!manual && Date.now() - ultima.current < CADA_MS) return;
    ultima.current = Date.now();
    const v = await buscarActualizacion();
    if (v) {
      setNueva(v);
      if (manual) setPospuesta(false);
    } else if (manual) {
      Alert.alert('Sin actualizaciones', `Tienes la versión más reciente (v${versionInstalada().nombre}).`);
    }
  }, []);

  useEffect(() => {
    revisar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') revisar();
    });
    const manual = () => { revisar(true); };
    pedidos.add(manual);
    return () => { sub.remove(); pedidos.delete(manual); };
  }, [revisar]);

  const actualizar = async () => {
    if (!nueva) return;
    setAvance(0);
    try {
      await descargarEInstalar(nueva, setAvance);
    } catch (e: any) {
      Alert.alert('Actualización', e?.message || 'No se pudo actualizar. Intenta de nuevo.');
    } finally {
      setAvance(null);
    }
  };

  if (!nueva || (pospuesta && !nueva.obligatoria)) return null;
  const mb = nueva.tamano ? ` · ${Math.round(nueva.tamano / 1048576)} MB` : '';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => !nueva.obligatoria && setPospuesta(true)}>
      <View style={styles.fondo}>
        <View style={styles.tarjeta}>
          <Text style={styles.titulo}>Actualización disponible</Text>
          <Text style={styles.version}>
            Versión {nueva.version}{mb} · tienes la {versionInstalada().nombre}
          </Text>
          {(nueva.notas || []).slice(0, 5).map((n) => (
            <Text key={n} style={styles.nota}>• {n}</Text>
          ))}

          {avance !== null ? (
            <View style={styles.progresoCaja}>
              <View style={styles.barra}><View style={[styles.relleno, { width: `${Math.round(avance * 100)}%` }]} /></View>
              <Text style={styles.ayuda}>Descargando… {Math.round(avance * 100)}%</Text>
            </View>
          ) : (
            <>
              <Pressable style={styles.boton} onPress={actualizar} accessibilityRole="button">
                <Text style={styles.botonTexto}>Actualizar ahora</Text>
              </Pressable>
              {!nueva.obligatoria && (
                <Pressable style={styles.botonSecundario} onPress={() => setPospuesta(true)} accessibilityRole="button">
                  <Text style={styles.botonSecundarioTexto}>Más tarde</Text>
                </Pressable>
              )}
            </>
          )}
          {avance === 0 && <ActivityIndicator color="#D32F2F" style={{ marginTop: 8 }} />}
          <Text style={styles.ayuda}>
            Se instala encima de la actual sin perder tus datos. Si Android lo pide, permite instalar apps de esta fuente y luego toca «Instalar».
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(8,12,18,0.72)', justifyContent: 'center', padding: 24 },
  tarjeta: { backgroundColor: '#121820', borderRadius: 14, padding: 22, borderWidth: 1, borderColor: '#2A3340' },
  titulo: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  version: { color: '#A0AEC0', fontSize: 14, marginTop: 6, marginBottom: 12 },
  nota: { color: '#E2E8F0', fontSize: 14, marginBottom: 4 },
  boton: { backgroundColor: '#D32F2F', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  botonTexto: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  botonSecundario: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  botonSecundarioTexto: { color: '#A0AEC0', fontSize: 15, fontWeight: '600' },
  progresoCaja: { marginTop: 16 },
  barra: { height: 8, borderRadius: 4, backgroundColor: '#2A3340', overflow: 'hidden' },
  relleno: { height: 8, backgroundColor: '#D32F2F' },
  ayuda: { color: '#718096', fontSize: 12, marginTop: 10, lineHeight: 17 },
});
