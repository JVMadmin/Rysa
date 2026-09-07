import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { login, User } from '@/services/auth';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Por favor ingresa tu correo y contraseña');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const user = await login(email, password);
      onLoginSuccess(user);
    } catch (err: any) {
      let msg = err?.message || 'Error al iniciar sesión';
      if (msg.includes('502') || msg.includes('Failed to fetch') || msg.includes('Network request failed')) {
        msg = 'No se pudo conectar con el servidor oficial (gruporysa.com). Verifica tu conexión a internet e inténtalo nuevamente.';
      }
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header & Branding Institucional */}
          <View style={styles.header}>
            <Image
              source={require('../../assets/images/rysa-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.brandTitle}>GRUPO RYSA</Text>
            <Text style={styles.brandSubtitle}>Vendedores & Operación en Campo</Text>
            <Text style={styles.brandVersion}>v1.2.0 Oficial</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Acceso de Asesores</Text>

            {errorMessage && (
              <View style={styles.errorBox}>
                <MaterialIcons name="error-outline" size={18} color="#D32F2F" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Email Field */}
            <Text style={styles.label}>Correo Electrónico</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="email" size={20} color="#718096" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="asesor@gruporysa.com"
                placeholderTextColor="#A0AEC0"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            {/* Password Field */}
            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.inputContainer}>
              <MaterialIcons name="lock" size={20} color="#718096" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="••••••••••••"
                placeholderTextColor="#A0AEC0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                editable={!loading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <MaterialIcons
                  name={showPassword ? 'visibility-off' : 'visibility'}
                  size={20}
                  color="#718096"
                />
              </TouchableOpacity>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.buttonInner}>
                  <Text style={styles.submitButtonText}>Entrar al Sistema</Text>
                  <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>

            {/* Indicador de Servidor Institucional Exclusivo */}
            <View style={styles.serverIndicator}>
              <MaterialIcons name="cloud-done" size={16} color="#2E7D32" />
              <Text style={styles.serverIndicatorText}>
                Red Grupo RYSA · gruporysa.com
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121820',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#121820',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 140,
    height: 95,
    marginBottom: 8,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#E2E8F0',
    marginTop: 4,
    fontWeight: '600',
  },
  brandVersion: {
    fontSize: 11,
    color: '#A0AEC0',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#121820',
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#D32F2F',
  },
  errorText: {
    color: '#C62828',
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
    lineHeight: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 6,
    marginTop: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    height: 46,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: '#1A202C',
  },
  eyeButton: {
    padding: 6,
  },
  submitButton: {
    backgroundColor: '#D32F2F',
    borderRadius: 10,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    elevation: 3,
    shadowColor: '#D32F2F',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  submitButtonDisabled: {
    backgroundColor: '#EF9A9A',
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  serverIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    gap: 6,
  },
  serverIndicatorText: {
    fontSize: 12,
    color: '#166534',
    fontWeight: '600',
  },
});
